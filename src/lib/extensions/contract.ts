import type { Standing } from '../membership';

// The contract between atmoBB and an extension: the manifest an extension
// ships, the viewer it is told about, and the payloads it passes to host
// functions. The authoring kit shares these types, so nothing here may import
// server-only code.

/**
 * The host API this build offers, as major.minor. Adding a host function bumps
 * the minor; removing or renaming one bumps the major.
 */
export const HOST_API_VERSION = '1.0';

/** A plain JSON object: not null and not an array. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Host function groups an extension can ask the admin to grant. */
export const CAPABILITIES = ['kv', 'records', 'timers', 'notify'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Every extension exports `action`; the rest are called only when present. */
export const REQUIRED_HANDLER_EXPORTS = ['action'] as const;
export const OPTIONAL_HANDLER_EXPORTS = ['attach', 'timer', 'openWork', 'migrate'] as const;
export type HandlerExport = (typeof REQUIRED_HANDLER_EXPORTS)[number] | (typeof OPTIONAL_HANDLER_EXPORTS)[number];

/** The manifest an extension ships, and what the admin reviews at install. */
export interface ExtensionManifest {
  /** The author's identifier, shown to admins. Never used for paths or routes. */
  id: string;
  name: string;
  /** The extension's own release version. */
  version: string;
  /** The host API this extension needs, as major.minor. */
  hostApi: string;
  /** Version of the extension's stored data; raising it runs `migrate`. */
  dataVersion: number;
  /** NSIDs the extension writes to the forum's repo. Each needs a record lexicon in `lexicons`. */
  collections: string[];
  capabilities: Capability[];
  /** Repository-relative path to the extension's UI entry point. */
  ui?: { entry: string };
  /** Repository-relative paths to the lexicon JSON files the extension ships. */
  lexicons: string[];
}

/** Who is looking at, or acting on, an extension's surface. */
export interface ViewerContext {
  /** Null when signed out. */
  did: string | null;
  standing: Standing;
  staff: boolean;
  banned: boolean;
}

/** A thread staff attached the extension to. */
export interface ThreadRef {
  /** The thread's at-uri. */
  uri: string;
}

/** The forum the extension runs on. */
export interface ForumRef {
  /** The forum account's DID: the repo extension records are written to. */
  did: string;
}

/** What `action` receives. */
export interface ActionInput {
  viewer: ViewerContext;
  /** The thread the action comes from, or null when it doesn't come from a thread. */
  thread: ThreadRef | null;
  forum: ForumRef;
  action: string;
  input: unknown;
}

/** What `attach` receives when staff attach the extension to a thread. */
export interface AttachInput {
  viewer: ViewerContext;
  thread: ThreadRef;
  forum: ForumRef;
  /** The setup the extension's own attach form collected. */
  input: unknown;
}

// Host-call payloads. Each host function takes one JSON payload and returns one.

export interface KvGet {
  key: string;
}
export interface KvGetResult {
  value: unknown | null;
}
export interface KvSet {
  key: string;
  value: unknown;
}
export interface KvDelete {
  key: string;
}
export interface KvList {
  /** Only keys starting with this are returned. */
  prefix: string;
  limit?: number;
  /** From a previous KvListResult, to fetch the next page. */
  cursor?: string;
}
export interface KvListResult {
  /** Sorted. */
  keys: string[];
  /** Set when there are more matching keys past `limit`. */
  cursor: string | null;
}

/** Records are always written to the forum's repo, as the forum account, in a declared collection. */
export interface RecordCreate {
  collection: string;
  rkey?: string;
  record: Record<string, unknown>;
}
export interface RecordPut {
  collection: string;
  rkey: string;
  record: Record<string, unknown>;
}
export interface RecordDelete {
  collection: string;
  rkey: string;
}
export interface RecordRef {
  uri: string;
  cid: string;
}
/** Reads may name any repo, but only a declared collection. */
export interface RecordList {
  /** The repo's DID. Omitted, the forum's own repo. */
  repo?: string;
  collection: string;
}
export interface RecordGet {
  /** The repo's DID. Omitted, the forum's own repo. */
  repo?: string;
  collection: string;
  rkey: string;
}
export interface StoredRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}
export interface RecordListResult {
  records: StoredRecord[];
  /** True when the listing stopped at the page cap with more records left. */
  truncated: boolean;
}

export interface TimerSet {
  /** Setting a name that is already pending replaces it. */
  name: string;
  /** ISO 8601 datetime. */
  at: string;
  payload?: unknown;
}
/** What `timer` receives: the timer as it was set, and the forum. */
export interface TimerInput extends TimerSet {
  forum: ForumRef;
}
export interface TimerCancel {
  name: string;
}

export interface NotifyPayload {
  /** Member DIDs. Members who haven't turned on notifications are skipped. */
  to: string[];
  /** The host puts the extension's name in front of it. */
  title: string;
  message: string;
  /** Path on the forum the notification links to. */
  link?: string;
}
export interface NotifyResult {
  /** How many notifications went to the relay. */
  sent: number;
}

// --- host ABI ------------------------------------------------------------------
//
// Host functions are imported from `extism:host/user`. Each takes a pointer to
// one JSON payload and returns a pointer to one JSON HostResult. Every
// function is always importable; one whose capability the install wasn't
// granted answers with the `capability_not_granted` error and does nothing.
//
// Handler exports read their input with Host.inputString() and write their
// output with Host.outputString(): `action` gets an ActionInput and `attach`
// gets an AttachInput, and both output a HandlerOutput; `timer` gets a
// TimerInput, `openWork` gets nothing and outputs a JSON boolean, and
// `migrate` gets a MigrateInput. A refusal's code and message reach the person
// who asked; a throw from any export fails the call with a generic error, and
// its text goes only to a log the forum's admins can read, along with console
// output.

/** Each host function and the capability that grants it. */
export const HOST_FUNCTIONS = {
  kv_get: 'kv',
  kv_set: 'kv',
  kv_delete: 'kv',
  kv_list: 'kv',
  record_create: 'records',
  record_put: 'records',
  record_delete: 'records',
  record_list: 'records',
  record_get: 'records',
  timer_set: 'timers',
  timer_cancel: 'timers',
  notify: 'notify',
} as const satisfies Record<string, Capability>;
export type HostFunctionName = keyof typeof HOST_FUNCTIONS;

/** Each host function's payload and the value it answers with. */
export interface HostFunctionTypes {
  kv_get: [KvGet, KvGetResult];
  kv_set: [KvSet, null];
  kv_delete: [KvDelete, null];
  kv_list: [KvList, KvListResult];
  record_create: [RecordCreate, RecordRef];
  record_put: [RecordPut, RecordRef];
  record_delete: [RecordDelete, null];
  record_list: [RecordList, RecordListResult];
  record_get: [RecordGet, StoredRecord | null];
  timer_set: [TimerSet, null];
  timer_cancel: [TimerCancel, null];
  notify: [NotifyPayload, NotifyResult];
}

export interface HostError {
  /** Stable and machine-readable, e.g. `capability_not_granted` or `CollectionNotApproved`. */
  code: string;
  message: string;
}
export type HostResult<T> = { ok: true; value: T } | { ok: false; error: HostError };

/** Longest refusal message, in characters. The host cuts longer ones. */
export const REFUSAL_MESSAGE_MAX = 300;
/** A refusal code: lowercase letters, digits, and underscores. */
export const REFUSAL_CODE = /^[a-z0-9_]{1,40}$/;

/** An extension turning down what it was asked, with a message for the person who asked. */
export interface Refused {
  code: string;
  message: string;
}

/** What `action` and `attach` output: the handler's value, or its refusal. */
export type HandlerOutput = { value: unknown } | { refused: Refused };

/** What `migrate` receives: the stored data's version and the version this release reads. */
export interface MigrateInput {
  from: number;
  to: number;
}
