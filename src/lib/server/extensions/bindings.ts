import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseAtUri } from '$lib/appview-paths';
import { THREAD_NSID, getBoardAccess, getThreadPage } from '../appview';
import { listForumRecords } from '../forum-repo';
import { getInstall, listInstalls } from './registry';
import { BINDING_COLLECTION } from './scopes';

// Which extension staff attached to which thread. The source of truth is the
// forum repo: atmoBB writes one app.atmobb.extension.binding record per bound
// thread, and only those records bind. Extensions can't write that collection,
// so nothing an extension publishes can bind a thread. DATA_DIR keeps a cache
// of them, rebuilt at boot and after an install, so rendering a thread never
// lists the repo. A binding says nothing about whether the thread is still
// public or visible; bindingAccess checks that on use.

export interface ThreadBinding {
  /** The thread's at-uri. */
  thread: string;
  installId: string;
  /** The binding record's at-uri. */
  uri: string;
  /** The extension's normalized git URL, as the record names it. */
  extension: string;
  attachedBy: string;
  createdAt: string;
}

interface BindingsStore {
  /** Keyed by thread at-uri. */
  bindings: Record<string, ThreadBinding>;
}

const B32 = '234567abcdefghijklmnopqrstuvwxyz';

/** The binding record's key for a thread: the first 160 bits of the at-uri's SHA-256, in base32. */
export function bindingRkey(threadUri: string): string {
  const digest = createHash('sha256').update(threadUri).digest().subarray(0, 20);
  let bits = 0n;
  for (const byte of digest) bits = (bits << 8n) | BigInt(byte);
  let key = '';
  for (let i = 31; i >= 0; i--) key += B32[Number((bits >> BigInt(i * 5)) & 31n)];
  return key;
}

const storePath = () => join(process.env.DATA_DIR ?? '.data', 'extensions', 'bindings.json');

async function loadStore(): Promise<BindingsStore> {
  try {
    return JSON.parse(await readFile(storePath(), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { bindings: {} };
  }
}

async function saveStore(store: BindingsStore) {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2));
  await rename(tmp, path);
}

// One change at a time, rebuilds included: an attach that lands while a
// rebuild lists the repo applies its change after the rebuild replaces the cache.
let chain: Promise<unknown> = Promise.resolve();
function withStore<T>(fn: (store: BindingsStore) => Promise<T> | T): Promise<T> {
  const run = chain.then(async () => {
    const store = await loadStore();
    const out = await fn(store);
    await saveStore(store);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

/** The cached binding for a thread, whatever state its install is in. */
export const cachedBinding = (threadUri: string): Promise<ThreadBinding | null> =>
  loadStore().then((store) => (Object.hasOwn(store.bindings, threadUri) ? store.bindings[threadUri] : null));

/** The extension bound to a thread, from the local cache only. Null when unbound or its install is gone or disabled. */
export async function bindingFor(threadUri: string): Promise<ThreadBinding | null> {
  const binding = await cachedBinding(threadUri);
  if (!binding) return null;
  const install = await getInstall(binding.installId);
  return install?.state === 'active' ? binding : null;
}

/** Cache a binding whose record was just written. */
export const cacheBinding = (binding: ThreadBinding) =>
  withStore((store) => {
    store.bindings[binding.thread] = binding;
  });

/** Drop a thread's cached binding. */
export const uncacheBinding = (threadUri: string) =>
  withStore((store) => {
    delete store.bindings[threadUri];
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Replace the cache with the forum repo's binding records, each mapped to the
 * install of the repository it names. Records for repositories that aren't
 * installed, or that don't sit at their thread's key, are skipped. When the
 * repo can't be listed the cache stays as it was.
 */
export function rebuildBindings(): Promise<void> {
  return withStore(async (store) => {
    const [records, installs] = await Promise.all([listForumRecords(BINDING_COLLECTION), listInstalls()]);
    const installByUrl = new Map(installs.map((install) => [install.normalizedUrl, install.id]));
    const bindings: Record<string, ThreadBinding> = {};
    for (const record of records) {
      const { value } = record;
      if (!isObject(value) || typeof value.thread !== 'string' || typeof value.extension !== 'string') continue;
      if (parseAtUri(value.thread)?.collection !== THREAD_NSID) continue;
      if (parseAtUri(record.uri)?.rkey !== bindingRkey(value.thread)) continue;
      const installId = installByUrl.get(value.extension);
      if (!installId) continue;
      bindings[value.thread] = {
        thread: value.thread,
        installId,
        uri: record.uri,
        extension: value.extension,
        attachedBy: typeof value.attachedBy === 'string' ? value.attachedBy : '',
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      };
    }
    store.bindings = bindings;
  });
}

/** Rebuild the cache without waiting on it, logging a failure. */
export function rebuildBindingsInBackground() {
  rebuildBindings().catch((error) =>
    console.error('[extensions] rebuilding thread bindings failed:', error instanceof Error ? error.message : error),
  );
}

export type BindingAccess =
  /** `board` is the thread's board, for checks that depend on it. */
  | { ok: true; board: string }
  | { ok: false; reason: 'missing' | 'hidden' | 'elsewhere' | 'members-only' | 'unavailable'; message: string };

/**
 * Whether an extension may run on a thread: it exists on this forum, isn't
 * hidden, and its board is public, because extension records are public.
 * Asks the appview, so it runs when a binding is used, not when one is read.
 * Anything the appview can't answer fails closed.
 */
export async function bindingAccess(threadUri: string): Promise<BindingAccess> {
  if (parseAtUri(threadUri)?.collection !== THREAD_NSID) {
    return { ok: false, reason: 'missing', message: 'That is not a thread on a public board.' };
  }
  try {
    const { thread } = await getThreadPage(threadUri, { limit: 1 });
    if (!thread) return { ok: false, reason: 'missing', message: "That thread isn't there. It may have been deleted." };
    if (thread.hidden) return { ok: false, reason: 'hidden', message: "That thread is hidden, so extensions can't run on it." };
    if (thread.origin) return { ok: false, reason: 'elsewhere', message: 'That thread belongs to another forum.' };
    if (await getBoardAccess(thread.value.board)) {
      return {
        ok: false,
        reason: 'members-only',
        message: 'That thread is on a members-only board. Extensions publish their records publicly, so they only run on public boards.',
      };
    }
    return { ok: true, board: thread.value.board };
  } catch {
    return { ok: false, reason: 'unavailable', message: "Couldn't check the thread right now. Try again in a minute." };
  }
}
