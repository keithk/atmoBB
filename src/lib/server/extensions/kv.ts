import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { KvDelete, KvGet, KvGetResult, KvList, KvListResult, KvSet } from '$lib/extensions/contract';
import { envInt } from './env';
import { RateWindows } from './rate-window';

// A private k/v store per extension install, namespaced by install id so two
// installs' keys never collide, one JSON file at
// DATA_DIR/extensions/<installId>/kv.json (bundles live in sha-named
// siblings under the same install directory, so this name can't collide with
// one). The file parses into a Map rather than a plain object, so a key
// named `__proto__` or `constructor` is stored as an ordinary entry instead
// of reaching the object prototype. Writes are serialized per install so
// concurrent sets don't clobber each other, and checked against quota caps
// before anything is written to disk.

export type KvErrorCode = 'key_too_long' | 'value_too_large' | 'too_many_keys' | 'store_too_large' | 'rate_limited';

/** A write refused for being over one of the per-install caps. */
export class KvQuotaError extends Error {
  constructor(
    public readonly code: KvErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KvQuotaError';
  }
}

/** How long an uninstalled install's store survives before purgeUninstalledKv removes it. */
export const KV_UNINSTALL_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_MAX_KEYS = 500;
const DEFAULT_MAX_KEY_LENGTH = 200;
const DEFAULT_MAX_VALUE_BYTES = 64 * 1024;
const DEFAULT_MAX_STORE_BYTES = 256 * 1024;
const DEFAULT_MAX_WRITES_PER_MINUTE = 60;
/** Installs whose write rate is tracked at once. */
const WRITE_WINDOWS_MAX = 5_000;

/** ATMOBB_KV_MAX_KEYS: key count per install. */
const maxKeys = () => envInt('ATMOBB_KV_MAX_KEYS', DEFAULT_MAX_KEYS);
/** ATMOBB_KV_MAX_KEY_LENGTH: characters per key. */
const maxKeyLength = () => envInt('ATMOBB_KV_MAX_KEY_LENGTH', DEFAULT_MAX_KEY_LENGTH);
/** ATMOBB_KV_MAX_VALUE_BYTES: serialized bytes per value. */
const maxValueBytes = () => envInt('ATMOBB_KV_MAX_VALUE_BYTES', DEFAULT_MAX_VALUE_BYTES);
/** ATMOBB_KV_MAX_STORE_BYTES: serialized bytes for an install's whole store. */
const maxStoreBytes = () => envInt('ATMOBB_KV_MAX_STORE_BYTES', DEFAULT_MAX_STORE_BYTES);
/** ATMOBB_KV_MAX_WRITES_PER_MINUTE: set or delete calls per install per rolling minute. */
const maxWritesPerMinute = () => envInt('ATMOBB_KV_MAX_WRITES_PER_MINUTE', DEFAULT_MAX_WRITES_PER_MINUTE);

const extensionsRoot = () => join(process.env.DATA_DIR ?? '.data', 'extensions');
const storePath = (installId: string) => join(extensionsRoot(), installId, 'kv.json');

interface KvFile {
  keys: Record<string, unknown>;
}

async function loadMap(installId: string): Promise<Map<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(storePath(installId), 'utf8')) as KvFile;
    return new Map(Object.entries(parsed.keys ?? {}));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return new Map();
  }
}

function serialize(map: Map<string, unknown>): string {
  // A null-prototype target means assigning a `__proto__` or `constructor`
  // entry creates an ordinary own property instead of doing anything special.
  const keys: Record<string, unknown> = Object.create(null);
  for (const [key, value] of map) keys[key] = value;
  return JSON.stringify({ keys } satisfies KvFile);
}

async function saveText(installId: string, text: string): Promise<void> {
  const path = storePath(installId);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, path);
}

const saveMap = (installId: string, map: Map<string, unknown>) => saveText(installId, serialize(map));

// One write at a time per install; different installs never block each other.
const chains = new Map<string, Promise<unknown>>();
function withInstall<T>(installId: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(installId) ?? Promise.resolve();
  const run = previous.then(fn);
  chains.set(
    installId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

// Sliding one-minute window of write timestamps, per install. Not persisted:
// losing it on restart is fine, since the on-disk byte quota is the backstop.
const writeWindows = new RateWindows(WRITE_WINDOWS_MAX);
function checkWriteRate(installId: string): void {
  if (!writeWindows.take(installId, maxWritesPerMinute(), 60_000)) {
    throw new KvQuotaError('rate_limited', `Install ${installId} is writing faster than ${maxWritesPerMinute()} times/minute`);
  }
}

/** Options for a write made by an update's migration. */
export interface KvWriteOptions {
  /**
   * Set for a migration's writes: they don't count against the write rate, and
   * once the signal aborts (the update gave up on the migration) they're
   * refused, checked in turn with the store's other writes so none lands
   * after a kvRestore that followed the abort.
   */
  migration?: AbortSignal;
}

function checkMigration(options: KvWriteOptions): void {
  if (options.migration?.aborted) throw new Error('The migration was abandoned, so its k/v writes are refused');
}

export async function kvGet(installId: string, payload: KvGet): Promise<KvGetResult> {
  const map = await loadMap(installId);
  return { value: map.has(payload.key) ? (map.get(payload.key) ?? null) : null };
}

export async function kvSet(installId: string, payload: KvSet, options: KvWriteOptions = {}): Promise<void> {
  const { key, value } = payload;
  if (key.length > maxKeyLength()) {
    throw new KvQuotaError('key_too_long', `Key is ${key.length} characters; the limit is ${maxKeyLength()}`);
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(value) ?? 'null';
  } catch {
    throw new TypeError('k/v value must be JSON-serializable');
  }
  if (Buffer.byteLength(encoded) > maxValueBytes()) {
    throw new KvQuotaError('value_too_large', `Value is ${Buffer.byteLength(encoded)} bytes; the limit is ${maxValueBytes()} bytes`);
  }

  await withInstall(installId, async () => {
    checkMigration(options);
    if (!options.migration) checkWriteRate(installId);
    const map = await loadMap(installId);
    const isNewKey = !map.has(key);
    if (isNewKey && map.size >= maxKeys()) {
      throw new KvQuotaError('too_many_keys', `This install already has ${map.size} keys; the limit is ${maxKeys()}`);
    }
    const next = new Map(map);
    next.set(key, value);
    const bytes = Buffer.byteLength(serialize(next));
    if (bytes > maxStoreBytes()) {
      throw new KvQuotaError('store_too_large', `The store would be ${bytes} bytes; the limit is ${maxStoreBytes()} bytes`);
    }
    await saveMap(installId, next);
  });
}

export async function kvDelete(installId: string, payload: KvDelete, options: KvWriteOptions = {}): Promise<void> {
  await withInstall(installId, async () => {
    checkMigration(options);
    const map = await loadMap(installId);
    if (!map.has(payload.key)) return;
    map.delete(payload.key);
    await saveMap(installId, map);
  });
}

export async function kvList(installId: string, payload: KvList): Promise<KvListResult> {
  const map = await loadMap(installId);
  const matches = [...map.keys()].filter((key) => key.startsWith(payload.prefix)).sort();
  const start = payload.cursor ? matches.findIndex((key) => key > payload.cursor!) : 0;
  const from = start === -1 ? matches.length : start;
  const limit = payload.limit ?? matches.length - from;
  const page = matches.slice(from, from + limit);
  const cursor = from + page.length < matches.length ? page[page.length - 1] : null;
  return { keys: page, cursor };
}

/** An install's whole store as it stood at one moment, or null when it had none. */
export type KvSnapshot = string | null;

/** Read the install's store, in turn with its writes. */
export function kvSnapshot(installId: string): Promise<KvSnapshot> {
  return withInstall(installId, async () => {
    try {
      return await readFile(storePath(installId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return null;
    }
  });
}

/** Put the install's store back as `snapshot` found it, in turn with its writes. */
export function kvRestore(installId: string, snapshot: KvSnapshot): Promise<void> {
  return withInstall(installId, () => (snapshot === null ? rm(storePath(installId), { force: true }) : saveText(installId, snapshot)));
}

/** One install's uninstall time, as input to purgeUninstalledKv. */
export interface UninstalledInstall {
  installId: string;
  /** ISO 8601 datetime. */
  uninstalledAt: string;
}

/**
 * Remove the store for every install uninstalled more than KV_UNINSTALL_GRACE_MS
 * ago. The registry doesn't record uninstall time, so the caller supplies it
 * (e.g. from its own record of recent uninstalls) rather than this function
 * reading the registry.
 */
export async function purgeUninstalledKv(uninstalls: UninstalledInstall[], now = Date.now()): Promise<string[]> {
  const purged: string[] = [];
  for (const { installId, uninstalledAt } of uninstalls) {
    const at = Date.parse(uninstalledAt);
    if (!Number.isFinite(at) || now - at < KV_UNINSTALL_GRACE_MS) continue;
    await withInstall(installId, () => rm(storePath(installId), { force: true }));
    purged.push(installId);
  }
  return purged;
}

/** The k/v store's shape, so a Postgres-backed implementation can replace this file later. */
export interface KvStore {
  get(installId: string, payload: KvGet): Promise<KvGetResult>;
  set(installId: string, payload: KvSet): Promise<void>;
  delete(installId: string, payload: KvDelete): Promise<void>;
  list(installId: string, payload: KvList): Promise<KvListResult>;
}

export const fileKvStore: KvStore = { get: kvGet, set: kvSet, delete: kvDelete, list: kvList };
