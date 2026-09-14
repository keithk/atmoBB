import { REFUSAL_CODE, REFUSAL_MESSAGE_MAX } from '../../src/lib/extensions/contract';
import type {
  ActionInput,
  AttachInput,
  HandlerOutput,
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
  TimerInput,
  TimerSet,
} from '../../src/lib/extensions/contract';

// The API extension authors write against. Inside the sandbox every host
// function takes and returns a pointer to JSON; these wrappers hide that, and
// turn a refused call into a thrown HostCallError. Console output goes to the
// log the forum's admins can read.

export type {
  ActionInput,
  AttachInput,
  Capability,
  ExtensionManifest,
  ForumRef,
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
  ThreadRef,
  TimerInput,
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
  /** Omit `repo` to read the forum's own repo, where `create` and `put` write. */
  list(payload: RecordList): RecordListResult {
    return callHost('record_list', payload);
  },
  /** Null when the record doesn't exist. Omit `repo` to read the forum's own repo. */
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

/** Thrown by `refuse`, and caught by the export wrapping `action` or `attach`. */
class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'Refusal';
  }
}

/**
 * Turn down an action or attach with a message for the person who asked, like
 * "You have no army in Paris." It's shown to them as is, so keep anything
 * private out of it. Messages over 300 characters are cut; `code` is
 * lowercase letters, digits, and underscores, up to 40. Any other throw fails
 * the call with a generic error and its text goes only to the extension log.
 */
export function refuse(message: string, code = 'refused'): never {
  if (typeof message !== 'string' || !message) throw new Error('refuse needs a message');
  if (typeof code !== 'string' || !REFUSAL_CODE.test(code)) throw new Error(`refuse code ${JSON.stringify(code)} must be lowercase letters, digits, and underscores, up to 40`);
  throw new Refusal(code, message.length > REFUSAL_MESSAGE_MAX ? `${message.slice(0, REFUSAL_MESSAGE_MAX - 1)}…` : message);
}

/** What an extension does when atmoBB calls it. Handlers run synchronously. */
export interface ExtensionHandlers {
  /** A viewer's action. The return value (any JSON) goes back to the caller; `refuse` turns the action down. */
  action(input: ActionInput): unknown;
  /**
   * Staff attached the extension to a thread, with the setup its attach form
   * collected. `refuse` turns the setup down with a message staff see; that or
   * any other throw undoes the attach, and atmoBB removes the binding.
   * Without this handler the extension can't be attached to threads.
   */
  attach?(input: AttachInput): unknown;
  /** A timer set with `timers.set` came due. */
  timer?(timer: TimerInput): void;
  /** Whether there's work in progress an admin should know about before disabling or uninstalling. */
  openWork?(): boolean;
  /** The stored data is at version `from`; bring it to `to`, this release's `dataVersion`. */
  migrate?(input: MigrateInput): void;
}

/** Declare the extension's handlers. The entry module's default export must be the result. */
export function defineExtension(handlers: ExtensionHandlers): ExtensionHandlers {
  return handlers;
}

const HANDLER_NAMES = ['action', 'attach', 'timer', 'openWork', 'migrate'] as const;

function settled(handler: string, value: unknown): unknown {
  if (value instanceof Promise) throw new Error(`The ${handler} handler returned a Promise; handlers must be synchronous`);
  return value;
}

const readInput = () => JSON.parse(Host.inputString());

// extism-js snapshots the script once it has loaded, Math.random's state
// included, so every cold start would replay the same sequence. The first call
// into an instance runs after that snapshot, so that's where Math.random is
// replaced with one drawn from crypto.getRandomValues.
let randomReplaced = false;
const randomWords = new Uint32Array(2);

function replaceMathRandom() {
  if (randomReplaced) return;
  randomReplaced = true;
  Math.random = () => {
    crypto.getRandomValues(randomWords);
    // 53 random bits, as a number in [0, 1).
    return (randomWords[0] * 2 ** 21 + (randomWords[1] >>> 11)) / 2 ** 53;
  };
}

/** Run a handler whose output goes back to a person: its value, or its refusal. */
function answer(handler: string, run: () => unknown) {
  let output: HandlerOutput;
  try {
    const value = settled(handler, run());
    output = { value: value === undefined ? null : value };
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    output = { refused: { code: error.code, message: error.message } };
  }
  Host.outputString(JSON.stringify(output));
}

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
  const { action, attach, timer, openWork, migrate } = handlers as ExtensionHandlers;
  for (const name of HANDLER_NAMES) {
    const handler = (handlers as Record<string, unknown>)[name];
    if (handler !== undefined && typeof handler !== 'function') throw new Error(`The ${name} handler must be a function`);
  }

  const exports: Record<string, () => void> = {
    action: () => answer('action', () => action.call(handlers, readInput())),
  };
  if (attach) exports.attach = () => answer('attach', () => attach.call(handlers, readInput()));
  if (timer) exports.timer = () => void settled('timer', timer.call(handlers, readInput()));
  if (openWork) exports.openWork = () => Host.outputString(JSON.stringify(settled('openWork', openWork.call(handlers)) === true));
  if (migrate) exports.migrate = () => void settled('migrate', migrate.call(handlers, readInput()));
  return Object.fromEntries(
    Object.entries(exports).map(([name, run]) => [
      name,
      () => {
        replaceMathRandom();
        run();
      },
    ]),
  );
}
