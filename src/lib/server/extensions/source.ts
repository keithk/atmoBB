import { Resolver } from 'node:dns/promises';
import { isValidDid, isValidHandle } from '@atproto/syntax';
import { isObject } from '$lib/extensions/contract';
import { unresolvedSource, type SourceIdentity } from '$lib/extensions/source';
import { outboundFetch, pdsServiceEndpoint, resolveDidDocument, type DidDocument, type OutboundFetchOptions, type OutboundFetchResult } from './outbound';
import { RateWindows } from './rate-window';

// Who a standalone page's source DID is, for the label atmoBB draws above a
// panel: the handle its DID document claims, whether that handle resolves
// back to it, and whether its repo holds an atmoBB forum profile. Every read
// goes to the DID's own identity and PDS through the hardened fetcher, never
// through Happyview, so the answer holds for a forum this install has never
// indexed or one that no longer runs. Visitors reach this signed out, so
// lookups are counted per client address. The names panels show people by
// (names.ts) resolve and verify handles, and read records, through the same
// helpers.

export const FORUM_PROFILE_COLLECTION = 'app.atmobb.forum.profile';
/** The forum profile's record key; the lexicon fixes it as `literal:self`. */
export const FORUM_PROFILE_RKEY = 'self';

export const SOURCE_CACHE_MAX = 500;
const SOURCE_TTL_MS = 5 * 60_000;
/** An unavailable answer is retried sooner, so a PDS blip doesn't stick for five minutes. */
const UNAVAILABLE_TTL_MS = 30_000;

export const SOURCE_LOOKUPS_PER_CLIENT_PER_MINUTE = 30;
const MINUTE_MS = 60_000;
const CLIENT_WINDOWS_MAX = 5_000;

const HANDLE_TIMEOUT_MS = 3_000;
const HANDLE_MAX_BYTES = 2_048;
const PROFILE_TIMEOUT_MS = 5_000;
/** A forum profile carries up to 100 KB of custom CSS besides everything else; an actor profile, per-forum overrides. */
const PROFILE_MAX_BYTES = 512 * 1024;
const FORUM_NAME_MAX = 100;

export interface SourceResolverDeps {
  resolveDidDocument(did: string): Promise<DidDocument>;
  resolveTxt(hostname: string): Promise<string[][]>;
  fetch(url: string, opts: OutboundFetchOptions): Promise<OutboundFetchResult>;
}

const dns = new Resolver({ timeout: HANDLE_TIMEOUT_MS, tries: 1 });
const networkDeps: SourceResolverDeps = { resolveDidDocument, resolveTxt: (hostname) => dns.resolveTxt(hostname), fetch: outboundFetch };
let deps = networkDeps;

const decodeJson = (body: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
};

/** The DID a handle resolves to: its `_atproto` TXT record when it has one, otherwise its HTTPS well-known. */
export async function handleDid(handle: string): Promise<string | null> {
  let records: string[][] = [];
  try {
    records = await deps.resolveTxt(`_atproto.${handle}`);
  } catch {
    // No TXT record, or DNS failed: try the well-known.
  }
  const dids = [...new Set(records.map((chunks) => chunks.join('')).filter((text) => text.startsWith('did=')).map((text) => text.slice(4)))];
  // More than one DID in DNS is a misconfigured handle, which resolves to nothing.
  if (dids.length) return dids.length === 1 && isValidDid(dids[0]) ? dids[0] : null;

  try {
    const res = await deps.fetch(`https://${handle}/.well-known/atproto-did`, { maxBytes: HANDLE_MAX_BYTES, timeoutMs: HANDLE_TIMEOUT_MS });
    if (res.status !== 200) return null;
    const did = new TextDecoder().decode(res.body).trim();
    return isValidDid(did) ? did : null;
  } catch {
    return null;
  }
}

/** The handle a DID document claims, lowercased, or null when its first at:// alias isn't a usable handle. */
export function claimedHandle(doc: DidDocument): string | null {
  const alias = doc.alsoKnownAs?.find((entry) => typeof entry === 'string' && entry.startsWith('at://'));
  const handle = alias?.slice('at://'.length).toLowerCase();
  return handle && isValidHandle(handle) && !handle.endsWith('.invalid') ? handle : null;
}

/** The DID's document, or null when it can't be read or is another DID's. */
export async function didDocumentFor(did: string): Promise<DidDocument | null> {
  try {
    const doc = await deps.resolveDidDocument(did);
    return isObject(doc) && doc.id === did ? doc : null;
  } catch {
    return null;
  }
}

export type RepoRecord = { status: 'found'; value: unknown } | { status: 'missing' } | { status: 'unavailable' };

/**
 * One record read straight from the DID's own PDS: found, missing when the
 * repo has no such record (or there's no PDS to hold one), or unavailable when
 * the PDS couldn't be read.
 */
export async function repoRecord(did: string, doc: DidDocument, collection: string, rkey: string): Promise<RepoRecord> {
  const pds = pdsServiceEndpoint(doc, did);
  if (typeof pds !== 'string' || !pds) return { status: 'missing' };

  const query = new URLSearchParams({ repo: did, collection, rkey });
  let res: OutboundFetchResult;
  try {
    res = await deps.fetch(`${pds.replace(/\/+$/, '')}/xrpc/com.atproto.repo.getRecord?${query}`, {
      headers: { accept: 'application/json' },
      maxBytes: PROFILE_MAX_BYTES,
      timeoutMs: PROFILE_TIMEOUT_MS,
    });
  } catch {
    return { status: 'unavailable' };
  }
  const body = decodeJson(res.body);
  if (res.status === 400 && isObject(body) && body.error === 'RecordNotFound') return { status: 'missing' };
  if (res.status !== 200 || !isObject(body)) return { status: 'unavailable' };
  if (body.uri !== undefined && body.uri !== `at://${did}/${collection}/${rkey}`) return { status: 'missing' };
  return { status: 'found', value: body.value };
}

type ForumCheck = { forum: boolean; forumName?: string; unavailable?: true };

/** Whether the DID's own PDS holds a forum profile record for it. */
async function forumProfile(did: string, doc: DidDocument): Promise<ForumCheck> {
  const record = await repoRecord(did, doc, FORUM_PROFILE_COLLECTION, FORUM_PROFILE_RKEY);
  if (record.status === 'unavailable') return { forum: false, unavailable: true };
  if (record.status === 'missing' || !isObject(record.value) || typeof record.value.name !== 'string') return { forum: false };
  const forumName = record.value.name.trim().slice(0, FORUM_NAME_MAX);
  return forumName ? { forum: true, forumName } : { forum: true };
}

async function resolveSource(did: string): Promise<SourceIdentity> {
  const doc = await didDocumentFor(did);
  if (!doc) return unresolvedSource(did);

  const handle = claimedHandle(doc);
  const [resolved, forum] = await Promise.all([handle ? handleDid(handle) : null, forumProfile(did, doc)]);
  return { did, handle, handleVerified: !!handle && resolved === did, ...forum };
}

// --- cache (bounded, oldest out) ----------------------------------------------

const cache = new Map<string, { identity: SourceIdentity; at: number }>();
const inflight = new Map<string, Promise<SourceIdentity>>();

function cached(did: string): SourceIdentity | undefined {
  const hit = cache.get(did);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= (hit.identity.unavailable ? UNAVAILABLE_TTL_MS : SOURCE_TTL_MS)) {
    cache.delete(did);
    return undefined;
  }
  return hit.identity;
}

function remember(did: string, identity: SourceIdentity) {
  cache.delete(did);
  cache.set(did, { identity, at: Date.now() });
  while (cache.size > SOURCE_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Who a source DID is, cached briefly; concurrent lookups for one DID share a resolution. Never throws. */
export async function sourceIdentity(did: string): Promise<SourceIdentity> {
  const hit = cached(did);
  if (hit) return hit;
  const running = inflight.get(did);
  if (running) return running;
  const lookup = resolveSource(did)
    .catch(() => unresolvedSource(did))
    .then((identity) => {
      remember(did, identity);
      return identity;
    })
    .finally(() => inflight.delete(did));
  inflight.set(did, lookup);
  return lookup;
}

// --- rate limit (per client address, sliding minute) ----------------------------

// Drops the least recently seen clients once too many are tracked; a dropped client starts a fresh window.
const clientWindows = new RateWindows(CLIENT_WINDOWS_MAX);

/** Take one of a client's lookups for this minute, or false when they've used them all. */
export function takeSourceLookup(client: string, now = Date.now()): boolean {
  return clientWindows.take(client, SOURCE_LOOKUPS_PER_CLIENT_PER_MINUTE, MINUTE_MS, now);
}

// --- test seams -------------------------------------------------------------------

/** Test-only: replace the resolver's network. Pass null to restore it. */
export function setSourceDepsForTests(next: SourceResolverDeps | null) {
  deps = next ?? networkDeps;
}

/** Test-only: the cache's current entry count. */
export const sourceCacheSizeForTests = () => cache.size;

export function resetSourceForTests() {
  deps = networkDeps;
  cache.clear();
  inflight.clear();
  clientWindows.clear();
}
