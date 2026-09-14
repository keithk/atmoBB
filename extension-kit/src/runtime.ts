import type {
  ActionInput,
  HostError,
  HostFunctionName,
  HostFunctionTypes,
  HostResult,
  KvListResult,
  MigrateInput,
  NotifyPayload,
  NotifyResult,
  RecordCreate,
  RecordDelete,
  RecordGet,
  RecordList,
  RecordListResult,
  RecordPut,
  RecordRef,
  StoredRecord,
  TimerSet,
} from '../../src/lib/extensions/contract';

// The API extension authors write against. Inside the sandbox every host
// function takes and returns a pointer to JSON; these wrappers hide that, and
// turn a refused call into a thrown HostCallError. Console output goes to the
// log the forum's admins can read.

export type {
  ActionInput,
  Capability,
  ExtensionManifest,
  KvListResult,
  MigrateInput,
  NotifyPayload,
  NotifyResult,
  RecordCreate,
  RecordDelete,
  RecordGet,
  RecordList,
  RecordListResult,
  RecordPut,
  RecordRef,
  StoredRecord,
  TimerSet,
  ViewerContext,
} from '../../src/lib/extensions/contract';

// Globals the Extism JS PDK provides inside the sandbox.
interface MemoryHandle {
  offset: number;
  readString(): string;
  free(): void;
}
declare const Host: {
  getFunctions(): Record<HostFunctionName, (ptr: number) => number>;
  inputString(): string;
  outputString(text: string): void;
};
declare const Memory: {
  fromString(text: string): MemoryHandle;
  find(ptr: number): MemoryHandle | undefined;
};

/** The host refused a call. `code` is stable, e.g. `capability_not_granted` or `rate_limited`. */
export class HostCallError extends Error {
  readonly code: string;
  /** The host function that refused. */
  readonly fn: HostFunctionName;

  constructor(fn: HostFunctionName, error: HostError) {
    super(error.message);
    this.name = 'HostCallError';
    this.code = error.code;
    this.fn = fn;
  }
}

let hostFunctions: ReturnType<typeof Host.getFunctions> | null = null;

function callHost<N extends HostFunctionName>(fn: N, payload: HostFunctionTypes[N][0]): HostFunctionTypes[N][1] {
  if (typeof Host === 'undefined') throw new Error(`${fn} can only be called from inside a handler`);
  hostFunctions ??= Host.getFunctions();
  const request = Memory.fromString(JSON.stringify(payload));
  const reply = Memory.find(hostFunctions[fn](request.offset));
  request.free();
  if (!reply) throw new Error(`${fn} returned no reply`);
  const result = JSON.parse(reply.readString()) as HostResult<HostFunctionTypes[N][1]>;
  reply.free();
  if (!result.ok) throw new HostCallError(fn, result.error);
  return result.value;
}

/** The install's private key/value store. Values are any JSON. */
export const kv = {
  /** The stored value, or null when the key isn't set. */
  get<T = unknown>(key: string): T | null {
    return callHost('kv_get', { key }).value as T | null;
  },
  set(key: string, value: unknown): void {
    callHost('kv_set', { key, value });
  },
  delete(key: string): void {
    callHost('kv_delete', { key });
  },
  /** Keys starting with `prefix`, sorted; pass the returned cursor back for the next page. */
  list(prefix: string, options: { limit?: number; cursor?: string } = {}): KvListResult {
    return callHost('kv_list', { prefix, ...options });
  },
};

/** Records in the extension's declared collections. Writes go to the forum's repo, as the forum account. */
export const records = {
  create(payload: RecordCreate): RecordRef {
    return callHost('record_create', payload);
  },
  put(payload: RecordPut): RecordRef {
    return callHost('record_put', payload);
  },
  delete(payload: RecordDelete): void {
    callHost('record_delete', payload);
  },
  list(payload: RecordList): RecordListResult {
    return callHost('record_list', payload);
  },
  /** Null when the record doesn't exist. */
  get(payload: RecordGet): StoredRecord | null {
    return callHost('record_get', payload);
  },
};

/** Timed callbacks to the extension's `timer` handler. */
export const timers = {
  /** Setting a name that's already pending replaces it. */
  set(timer: TimerSet): void {
    callHost('timer_set', timer);
  },
  cancel(name: string): void {
    callHost('timer_cancel', { name });
  },
};

/** Notify forum members. Members who haven't turned notifications on are skipped. */
export function notify(payload: NotifyPayload): NotifyResult {
  return callHost('notify', payload);
}

/** What an extension does when atmoBB calls it. Handlers run synchronously. */
export interface ExtensionHandlers {
  /** A viewer's action. The return value (any JSON) goes back to the caller. */
  action(input: ActionInput): unknown;
  /** A timer set with `timers.set` came due. */
  timer?(timer: TimerSet): void;
  /** Whether there's work in progress an admin should know about before disabling or uninstalling. */
  openWork?(): boolean;
  /** The stored data is at version `from`; bring it to `to`, this release's `dataVersion`. */
  migrate?(input: MigrateInput): void;
}

/** Declare the extension's handlers. The entry module's default export must be the result. */
export function defineExtension(handlers: ExtensionHandlers): ExtensionHandlers {
  return handlers;
}

const HANDLER_NAMES = ['action', 'timer', 'openWork', 'migrate'] as const;

function settled(handler: string, value: unknown): unknown {
  if (value instanceof Promise) throw new Error(`The ${handler} handler returned a Promise; handlers must be synchronous`);
  return value;
}

const readInput = () => JSON.parse(Host.inputString());

/**
 * The module exports the compiler wires to the sandbox: one per handler the
 * extension defines, so atmoBB sees exactly which handlers exist. The kit's
 * build calls this on the author's default export.
 */
export function guestExports(definition: unknown): Record<string, () => void> {
  const handlers = (definition as { default?: unknown })?.default ?? definition;
  if (typeof handlers !== 'object' || handlers === null || typeof (handlers as ExtensionHandlers).action !== 'function') {
    throw new Error('The entry module must `export default defineExtension({ action() { ... } })`');
  }
  const { action, timer, openWork, migrate } = handlers as ExtensionHandlers;
  for (const name of HANDLER_NAMES) {
    const handler = (handlers as Record<string, unknown>)[name];
    if (handler !== undefined && typeof handler !== 'function') throw new Error(`The ${name} handler must be a function`);
  }

  const exports: Record<string, () => void> = {
    action() {
      const output = settled('action', action.call(handlers, readInput()));
      Host.outputString(JSON.stringify(output === undefined ? null : output));
    },
  };
  if (timer) exports.timer = () => void settled('timer', timer.call(handlers, readInput()));
  if (openWork) exports.openWork = () => Host.outputString(JSON.stringify(settled('openWork', openWork.call(handlers)) === true));
  if (migrate) exports.migrate = () => void settled('migrate', migrate.call(handlers, readInput()));
  return exports;
}
