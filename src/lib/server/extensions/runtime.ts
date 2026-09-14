import createPlugin, { type CallContext, type Plugin } from '@extism/extism';
import { readFile } from 'node:fs/promises';

// Extensions run as Extism plug-ins: QuickJS compiled to WebAssembly, each
// install in its own worker thread. The guest reaches the host only through
// the functions an install is granted. WASI gets no preopened directories, no
// environment, and no stdio; Extism's HTTP import refuses every host because
// allowedHosts is empty.

/** A capability granted to the guest, imported by it from `extism:host/user`. */
export type HostFunction = (context: CallContext, ...args: bigint[]) => unknown;

export interface ExtensionModule {
  /** The compiled plug-in, as bytes or a path to the .wasm file. */
  wasm: Uint8Array | string;
  functions: Record<string, HostFunction>;
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

/** A call stopped because it ran out of time or memory. */
export class ExtensionLimitError extends Error {
  constructor(
    readonly limit: 'timeout' | 'memory',
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionLimitError';
  }
}

const WASM_PAGE_BYTES = 64 * 1024;
const MEMORY_SECTION = 5;

function readVarUint(bytes: Uint8Array, offset: number): [value: number, next: number] {
  let value = 0;
  let shift = 0;
  let byte: number;
  do {
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
    const content = varUint(count);
    for (let i = 0; i < count; i++) {
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

  async function start(installId: string): Promise<Plugin> {
    const module = await load(installId);
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
        logLevel: 'silent',
        functions: { 'extism:host/user': module.functions },
      },
    );
  }

  async function stop(install: Install) {
    const plugin = install.plugin;
    install.plugin = null;
    await plugin?.then((p) => p.close()).catch(() => {});
  }

  function enqueue<T>(install: Install, task: () => Promise<T>): Promise<T> {
    const run = install.tail.then(task);
    install.tail = run.catch(() => {});
    return run;
  }

  async function run(installId: string, install: Install, name: string, input: string): Promise<string> {
    if (install.idle) clearTimeout(install.idle);
    install.plugin ??= start(installId);
    try {
      const output = await (await install.plugin).call(name, input);
      return output?.text() ?? '';
    } catch (err) {
      // After a timeout or a throwing host function the SDK may be restarting
      // or closing its worker, so start clean on the next call.
      await stop(install);
      throw asLimitError(err);
    } finally {
      install.idle = setTimeout(() => void enqueue(install, () => stop(install)), idleMs);
      install.idle.unref();
    }
  }

  return {
    call(installId: string, name: string, input: string): Promise<string> {
      let install = installs.get(installId);
      if (!install) {
        install = { tail: Promise.resolve(), plugin: null, idle: null };
        installs.set(installId, install);
      }
      const target = install;
      return enqueue(target, () => run(installId, target, name, input));
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
