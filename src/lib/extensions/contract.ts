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

/** Host function groups an extension can ask the admin to grant. */
export const CAPABILITIES = ['kv', 'records', 'timers', 'notify'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Every extension exports `action`; the rest are called only when present. */
export const REQUIRED_HANDLER_EXPORTS = ['action'] as const;
export const OPTIONAL_HANDLER_EXPORTS = ['timer', 'openWork', 'migrate'] as const;
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
  /** A declared collection whose records attach to a thread, and the record field holding the thread's at-uri. */
  binding?: { collection: string; threadField: string };
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

/** What `action` receives. */
export interface ActionInput {
  viewer: ViewerContext;
  action: string;
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

export interface TimerSet {
  /** Setting a name that is already pending replaces it. */
  name: string;
  /** ISO 8601 datetime. */
  at: string;
  payload?: unknown;
}
export interface TimerCancel {
  name: string;
}

export interface NotifyPayload {
  /** Member DIDs. */
  to: string[];
  message: string;
  /** Path on the forum the notification links to. */
  link?: string;
}
