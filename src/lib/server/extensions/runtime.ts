import createPlugin, { type CallContext, type Plugin } from '@extism/extism';
import { readFile } from 'node:fs/promises';

// Extensions run as Extism plug-ins: QuickJS compiled to WebAssembly, each
// install in its own worker thread. The guest reaches the host only through
// the functions an install is granted. WASI gets no preopened directories, no
// environment, and no stdio; Extism's HTTP import refuses every host because
// allowedHosts is empty.

/** A capability granted to the guest, imported by it from `extism:host/user`. */
export type HostFunction = (context: CallContext, ...args: bigint[]) => unknown;

export type GuestLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface ExtensionModule {
  /** The compiled plug-in, as bytes or a path to the .wasm file. */
  wasm: Uint8Array | string;
  functions: Record<string, HostFunction>;
  /** Receives the guest's console output. Without it, console output is dropped. */
  log?: (level: GuestLogLevel, text: string) => void;
}

export interface CallOptions {
  /** Handed to host functions for this call through `context.hostContext()`. */
  hostContext?: unknown;
  /** Output longer than this fails the call. */
  maxOutputBytes?: number;
  /**
   * Run this call on a one-off instance of `module` instead of the install's
   * own, still in turn with the install's other calls. The install's instance
   * is closed first, so the next ordinary call cold-starts from `load`.
   */
  module?: ExtensionModule;
}

export interface RuntimeLimits {
  /** Wall-clock budget for one call, time spent in host functions included. */
  timeoutMs: number;
  /** Ceiling on guest linear memory, in 64 KiB WebAssembly pages. */
  memoryPages: number;
  /** How long an install's instance may sit unused before its worker is closed. */
  idleMs: number;
}

const DEFAULT_LIMITS: RuntimeLimits = { timeoutMs: 5_000, memoryPages: 1_024, idleMs: 5 * 60_000 };

/** A call stopped because it ran out of time or memory, or its output was too long. */
export class ExtensionLimitError extends Error {
  constructor(
    readonly limit: 'timeout' | 'memory' | 'output',
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionLimitError';
  }
}

/** The SDK never settled a call, so its plug-in can't be trusted to answer or close. */
class StuckPluginError extends ExtensionLimitError {
  constructor() {
    super('timeout', 'Extension call ran past its time limit');
  }
}

const WASM_PAGE_BYTES = 64 * 1024;
const MEMORY_SECTION = 5;

function readVarUint(bytes: Uint8Array, offset: number): [value: number, next: number] {
  let value = 0;
  let shift = 0;
  let byte: number;
  do {
    if (offset >= bytes.length) throw new Error('Extension module ends inside a number');
    byte = bytes[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [value, offset];
}

function varUint(value: number): number[] {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
}

/**
 * Rewrite the module's memory section so every memory it defines has a
 * maximum of `maxPages`. Extism's own memory.maxPages option only counts the
 * host-side buffers it hands the guest; the engine enforces this one, so the
 * guest's allocator sees memory.grow fail at the ceiling. Extism rejects
 * modules that import memory, so defined memories are the only ones.
 */
export function capMemory(bytes: Uint8Array, maxPages: number): Uint8Array {
  if (!WebAssembly.validate(bytes as Uint8Array<ArrayBuffer>)) throw new Error('Extension module is not valid WebAssembly');
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset < bytes.length) {
    const id = bytes[offset];
    const [size, contentStart] = readVarUint(bytes, offset + 1);
    const end = contentStart + size;
    if (id !== MEMORY_SECTION) {
      parts.push(bytes.subarray(offset, end));
      offset = end;
      continue;
    }
    let [count, cursor] = readVarUint(bytes, contentStart);
    // Each memory takes at least two bytes, so a count the section can't hold is refused before the loop.
    if (count * 2 > end - cursor) throw new Error('Extension module declares more memories than its memory section holds');
    const content = varUint(count);
    for (let i = 0; i < count; i++) {
      if (cursor >= end) throw new Error('Extension module declares more memories than its memory section holds');
      const flags = bytes[cursor++];
      if (flags & 0x04) throw new Error('64-bit memories are not supported');
      let min: number;
      let max = Infinity;
      [min, cursor] = readVarUint(bytes, cursor);
      if (flags & 0x01) [max, cursor] = readVarUint(bytes, cursor);
      if (min > maxPages) {
        throw new Error(`Extension needs ${min} memory pages at startup; the limit is ${maxPages}`);
      }
      content.push(flags | 0x01, ...varUint(min), ...varUint(Math.min(max, maxPages)));
    }
    parts.push(Uint8Array.from([MEMORY_SECTION, ...varUint(content.length), ...content]));
    offset = end;
  }
  return Buffer.concat(parts);
}

function asLimitError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  if (/EXTISM: (call canceled due to timeout|timed out while waiting for plugin to instantiate)/.test(message)) {
    return new ExtensionLimitError('timeout', 'Extension call ran past its time limit');
  }
  if (/out of memory/i.test(message)) {
    return new ExtensionLimitError('memory', 'Extension call ran past its memory limit');
  }
  return err;
}

/** Routes the SDK's log calls, the guest's console output among them, to `log`. */
function guestLogger(log: (level: GuestLogLevel, text: string) => void): Console {
  const levels: GuestLogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];
  return Object.fromEntries(levels.map((level) => [level, (text: unknown) => log(level, String(text))])) as unknown as Console;
}

interface Install {
  /** Settles when the install's latest queued call does; calls chain onto it. */
  tail: Promise<unknown>;
  plugin: Promise<Plugin> | null;
  idle: ReturnType<typeof setTimeout> | null;
}

/**
 * Runs extension exports. `load` supplies an install's module and granted
 * host functions whenever its instance cold-starts. Calls to one install run
 * one at a time, in order; calls to different installs run concurrently.
 */
export function extensionRuntime(
  load: (installId: string) => Promise<ExtensionModule>,
  limits: Partial<RuntimeLimits> = {},
) {
  const { timeoutMs, memoryPages, idleMs } = { ...DEFAULT_LIMITS, ...limits };
  const installs = new Map<string, Install>();
  // The SDK cancels a call at timeoutMs and gives its worker restart another
  // timeoutMs. When that restart hangs or fails, the SDK never settles the
  // call, so the host stops waiting on its own shortly after both budgets.
  const watchdogMs = 2 * timeoutMs + 1_000;

  async function start(module: ExtensionModule): Promise<Plugin> {
    const bytes = typeof module.wasm === 'string' ? await readFile(module.wasm) : module.wasm;
    return createPlugin(
      { wasm: [{ data: capMemory(bytes, memoryPages) }] },
      {
        useWasi: true,
        // Timeouts and async host functions on Node 22 both need the worker.
        runInWorker: true,
        timeoutMs,
        allowedHosts: [],
        allowedPaths: {},
        enableWasiOutput: false,
        ...(module.log ? { logLevel: 'info' as const, logger: guestLogger(module.log) } : { logLevel: 'silent' as const }),
        functions: { 'extism:host/user': module.functions },
      },
    );
  }

  async function stop(install: Install) {
    const plugin = install.plugin;
    install.plugin = null;
    await plugin?.then((p) => p.close()).catch(() => {});
  }

  /** Detach the install's instance and close it without waiting, since a stuck plug-in may never finish closing. */
  function abandon(install: Install) {
    const plugin = install.plugin;
    install.plugin = null;
    void plugin?.then((p) => p.close()).catch(() => {});
  }

  /** Settles as `work` does, or rejects with StuckPluginError once watchdogMs pass first. */
  function watched<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StuckPluginError()), watchdogMs);
    });
    return Promise.race([work, expired]).finally(() => clearTimeout(timer));
  }

  function enqueue<T>(install: Install, task: () => Promise<T>): Promise<T> {
    const run = install.tail.then(task);
    install.tail = run.catch(() => {});
    return run;
  }

  async function invoke(plugin: Plugin, name: string, input: string, options: CallOptions): Promise<string | null> {
    if (!(await plugin.functionExists(name))) return null;
    const output = await plugin.call(name, input, options.hostContext);
    if (!output) return '';
    const bytes = output.arrayBuffer().byteLength;
    if (options.maxOutputBytes !== undefined && bytes > options.maxOutputBytes) {
      throw new ExtensionLimitError('output', `Extension output was ${bytes} bytes; the limit is ${options.maxOutputBytes}`);
    }
    return output.text();
  }

  async function run(installId: string, install: Install, name: string, input: string, options: CallOptions): Promise<string | null> {
    if (install.idle) clearTimeout(install.idle);
    if (options.module) {
      await stop(install);
      let plugin: Plugin | null = null;
      try {
        plugin = await start(options.module);
        return await watched(invoke(plugin, name, input, options));
      } catch (err) {
        if (err instanceof StuckPluginError) {
          void plugin?.close().catch(() => {});
          plugin = null;
        }
        throw asLimitError(err);
      } finally {
        await plugin?.close().catch(() => {});
      }
    }
    return withInstance(installId, install, (plugin) => invoke(plugin, name, input, options));
  }

  /** Run `task` on the install's instance, starting it when it isn't live. */
  async function withInstance<T>(installId: string, install: Install, task: (plugin: Plugin) => Promise<T>): Promise<T> {
    if (install.idle) clearTimeout(install.idle);
    install.plugin ??= load(installId).then(start);
    try {
      return await watched(task(await install.plugin));
    } catch (err) {
      // After a timeout or a throwing host function the SDK may be restarting
      // or closing its worker, so start clean on the next call. The install
      // stays in `installs` so calls already queued keep their order; they
      // and later calls cold-start a new instance.
      if (err instanceof StuckPluginError) abandon(install);
      else await stop(install);
      throw asLimitError(err);
    } finally {
      install.idle = setTimeout(() => void enqueue(install, () => stop(install)), idleMs);
      install.idle.unref();
    }
  }

  function installFor(installId: string): Install {
    let install = installs.get(installId);
    if (!install) {
      install = { tail: Promise.resolve(), plugin: null, idle: null };
      installs.set(installId, install);
    }
    return install;
  }

  return {
    /** Call an export. Resolves to null when the module doesn't export `name`. */
    call(installId: string, name: string, input: string, options: CallOptions = {}): Promise<string | null> {
      const install = installFor(installId);
      return enqueue(install, () => run(installId, install, name, input, options));
    },

    /** Whether the install's module exports `name`, in turn with the install's calls. */
    has(installId: string, name: string): Promise<boolean> {
      const install = installFor(installId);
      return enqueue(install, () => withInstance(installId, install, (plugin) => plugin.functionExists(name)));
    },

    /** Close an install's instance once its queued calls finish, so the next call loads it again. */
    evict(installId: string): Promise<void> {
      const install = installs.get(installId);
      if (!install) return Promise.resolve();
      if (install.idle) clearTimeout(install.idle);
      return enqueue(install, () => stop(install));
    },

    /** Close every instance once its queued calls finish. */
    async close(): Promise<void> {
      await Promise.all(
        [...installs.values()].map((install) => {
          if (install.idle) clearTimeout(install.idle);
          return enqueue(install, () => stop(install));
        }),
      );
    },
  };
}
