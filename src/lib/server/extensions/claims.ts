import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Each collection an extension declares belongs to exactly one source
// repository. The claim is keyed by normalized git URL, not by install, so it
// outlives an uninstall: a different repository can't take over a collection
// whose records are already in the forum's repo until an admin releases it.

export interface CollectionClaim {
  gitUrl: string;
  claimedAt: string;
}

export interface ClaimConflict {
  collection: string;
  heldBy: string;
}

interface ClaimsStore {
  claims: Record<string, CollectionClaim>;
}

/**
 * Installs, their data directories, and /x/ routes are named by this, never by
 * the manifest's id: 16 random bytes as base64url, 22 characters, one path segment.
 */
export const newInstallId = () => randomBytes(16).toString('base64url');

/**
 * One key per repository: scheme and host lowercased (URL does that), default
 * port, user info, and fragment dropped, trailing slashes and `.git` stripped.
 * Path case is kept; not every host treats it as insensitive.
 */
export function normalizeGitUrl(raw: string): string {
  const url = new URL(raw.trim());
  url.username = '';
  url.password = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return url.toString();
}

const storePath = () => join(process.env.DATA_DIR ?? '.data', 'extensions', 'claims.json');

async function loadStore(): Promise<ClaimsStore> {
  try {
    return JSON.parse(await readFile(storePath(), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { claims: {} };
  }
}

async function saveStore(store: ClaimsStore) {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2));
  await rename(tmp, path);
}

// One mutation at a time; the store is a single JSON file.
let chain: Promise<unknown> = Promise.resolve();
function withStore<T>(fn: (store: ClaimsStore) => Promise<T> | T): Promise<T> {
  const run = chain.then(async () => {
    const store = await loadStore();
    const out = await fn(store);
    await saveStore(store);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

function conflictsIn(store: ClaimsStore, gitUrl: string, collections: string[]): ClaimConflict[] {
  const key = normalizeGitUrl(gitUrl);
  return collections.flatMap((collection) => {
    const held = store.claims[collection];
    return held && held.gitUrl !== key ? [{ collection, heldBy: held.gitUrl }] : [];
  });
}

export const listClaims = () => loadStore().then((s) => s.claims);

/** Collections held by a different repository, for the install review. */
export const claimConflicts = (gitUrl: string, collections: string[]) =>
  loadStore().then((store) => conflictsIn(store, gitUrl, collections));

/** Claim every collection for the repository, or none of them if any is held elsewhere. */
export function claimCollections(
  gitUrl: string,
  collections: string[],
): Promise<{ ok: true } | { ok: false; conflicts: ClaimConflict[] }> {
  return withStore((store) => {
    const conflicts = conflictsIn(store, gitUrl, collections);
    if (conflicts.length) return { ok: false, conflicts };
    const key = normalizeGitUrl(gitUrl);
    const claimedAt = new Date().toISOString();
    for (const collection of collections) {
      store.claims[collection] ??= { gitUrl: key, claimedAt };
    }
    return { ok: true };
  });
}

/** An admin's explicit release. Returns whether there was a claim to release. */
export function releaseClaim(collection: string): Promise<boolean> {
  return withStore((store) => {
    if (!store.claims[collection]) return false;
    delete store.claims[collection];
    return true;
  });
}
