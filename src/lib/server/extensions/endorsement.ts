import { env } from '$env/dynamic/private';
import { isObject } from '$lib/extensions/contract';
import { parseAtUri } from '$lib/appview-paths';
import { FORUM_DID } from '../appview';
import { getForumRecord, listForumRecords, putForumRecord } from '../forum-repo';
import { normalizeGitUrl } from './claims';
import { hashRkey } from './hash-rkey';
import { OutboundFetchError, outboundFetch, pdsServiceEndpoint, resolveDidDocument } from './outbound';
import { ENDORSEMENT_COLLECTION } from './scopes';

// The trusted mark: an app.atmobb.extension.endorsement record in the
// atmobb.app directory forum's repo, naming a repository and the release
// SHAs staff reviewed. Which forum is the directory is named by
// ATMOBB_EXTENSION_DIRECTORY_DID — every install (including the directory's
// own) reads it to show the mark on an install review, and it's a signal
// only, never a gate: any failure here reads as unverified and never blocks
// an install.

/** The endorsement record's key for a repository: the first 160 bits of its normalized git URL's SHA-256, in base32. */
export function endorsementRkey(gitUrl: string): string {
  return hashRkey(normalizeGitUrl(gitUrl));
}

export interface EndorsementRecord {
  uri: string;
  gitUrl: string;
  key: string;
  reviewed: string[];
  listing?: string;
  createdAt: string;
  updatedAt: string;
}

function parseValue(uri: string, value: Record<string, unknown>): EndorsementRecord {
  const reviewed = Array.isArray(value.reviewed) ? value.reviewed.filter((s): s is string => typeof s === 'string') : [];
  return {
    uri,
    gitUrl: typeof value.gitUrl === 'string' ? value.gitUrl : '',
    key: typeof value.key === 'string' ? value.key : '',
    reviewed,
    listing: typeof value.listing === 'string' ? value.listing : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  };
}

// --- writes (the directory forum's own repo, via the endorse admin page) ---

/** Every endorsement in this forum's own repo, sorted by repository. */
export async function listEndorsements(): Promise<EndorsementRecord[]> {
  const records = await listForumRecords(ENDORSEMENT_COLLECTION);
  return records
    .flatMap((record) => (isObject(record.value) ? [parseValue(record.uri, record.value)] : []))
    .sort((a, b) => a.gitUrl.localeCompare(b.gitUrl) || a.uri.localeCompare(b.uri));
}

/** This forum's own endorsement of a repository, or null when there is none. */
export async function getEndorsement(gitUrl: string): Promise<EndorsementRecord | null> {
  const record = await getForumRecord(ENDORSEMENT_COLLECTION, endorsementRkey(gitUrl));
  return record && isObject(record.value) ? parseValue(record.uri, record.value) : null;
}

/** Add `sha` to a repository's reviewed releases, creating the endorsement if this is the first one. Idempotent. */
export async function endorseRelease(gitUrl: string, sha: string, listing?: string): Promise<EndorsementRecord> {
  const existing = await getEndorsement(gitUrl);
  const now = new Date().toISOString();
  const reviewed = Array.from(new Set([...(existing?.reviewed ?? []), sha]));
  const resolvedListing = listing ?? existing?.listing;
  const value = {
    gitUrl: existing?.gitUrl || gitUrl,
    key: normalizeGitUrl(gitUrl),
    reviewed,
    ...(resolvedListing ? { listing: resolvedListing } : {}),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const { uri } = await putForumRecord(ENDORSEMENT_COLLECTION, endorsementRkey(gitUrl), value);
  return { uri, ...value };
}

/** Drop one SHA from a repository's reviewed releases. Null when the repository has no endorsement. */
export async function removeReviewedSha(gitUrl: string, sha: string): Promise<EndorsementRecord | null> {
  const existing = await getEndorsement(gitUrl);
  if (!existing) return null;
  const value = {
    gitUrl: existing.gitUrl,
    key: existing.key,
    reviewed: existing.reviewed.filter((reviewed) => reviewed !== sha),
    ...(existing.listing ? { listing: existing.listing } : {}),
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const { uri } = await putForumRecord(ENDORSEMENT_COLLECTION, endorsementRkey(gitUrl), value);
  return { uri, ...value };
}

// --- lookup (every install, at review time) ---

export type EndorsementLookup = { status: 'unverified' } | { status: 'endorsed'; reviewed: boolean; listing?: string };

type RawEndorsement = { found: false; unavailable?: true } | { found: true; reviewed: string[]; listing?: string };

const READ_MAX_BYTES = 64 * 1024;
const READ_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 3 * 60_000;
/** A failed lookup is retried sooner, so a directory outage doesn't read as unverified for the full successful-lookup TTL. */
const UNAVAILABLE_TTL_MS = 30_000;
const CACHE_MAX = 500;

const cache = new Map<string, { at: number; raw: RawEndorsement }>();
const inflight = new Map<string, Promise<RawEndorsement>>();

function cacheGet(key: string): RawEndorsement | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  const ttl = !hit.raw.found && hit.raw.unavailable ? UNAVAILABLE_TTL_MS : CACHE_TTL_MS;
  if (Date.now() - hit.at >= ttl) {
    cache.delete(key);
    return undefined;
  }
  return hit.raw;
}

function cacheSet(key: string, raw: RawEndorsement) {
  cache.delete(key);
  cache.set(key, { raw, at: Date.now() });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test-only: clear the lookup cache. */
export function clearEndorsementCacheForTests() {
  cache.clear();
}

/** The record, only when its at-uri actually sits in the directory DID's repo at the key asked for. */
function counted(raw: unknown, directoryDid: string, rkey: string): EndorsementRecord | null {
  if (!isObject(raw) || typeof raw.uri !== 'string' || !isObject(raw.value)) return null;
  const at = parseAtUri(raw.uri);
  if (!at || at.did !== directoryDid || at.collection !== ENDORSEMENT_COLLECTION || at.rkey !== rkey) return null;
  return parseValue(raw.uri, raw.value);
}

/** One XRPC read of the directory DID's repo, through the hardened outbound fetcher. Throws on any failure. */
async function fetchFromDirectoryPds(directoryDid: string, rkey: string): Promise<RawEndorsement> {
  const doc = await resolveDidDocument(directoryDid);
  if (doc.id !== directoryDid) throw new Error(`${directoryDid}'s DID document names a different DID`);
  const endpoint = pdsServiceEndpoint(doc, directoryDid);
  if (!endpoint) throw new Error(`${directoryDid} lists no PDS`);
  const pds = endpoint.replace(/\/+$/, '');
  const params = new URLSearchParams({ repo: directoryDid, collection: ENDORSEMENT_COLLECTION, rkey });
  const res = await outboundFetch(`${pds}/xrpc/com.atproto.repo.getRecord?${params}`, {
    headers: { accept: 'application/json' },
    maxBytes: READ_MAX_BYTES,
    timeoutMs: READ_TIMEOUT_MS,
  });
  if (res.status === 400) return { found: false };
  if (res.status !== 200) throw new Error(`directory PDS answered with status ${res.status}`);
  const body: unknown = JSON.parse(new TextDecoder().decode(res.body));
  const record = counted(body, directoryDid, rkey);
  return record ? { found: true, reviewed: record.reviewed, listing: record.listing } : { found: false };
}

async function rawEndorsementFor(gitUrl: string): Promise<RawEndorsement> {
  // Which forum is the directory. Unset on every install by default; only the
  // directory forum itself sets it (to its own DID), which is also what lets
  // other installs know where to look.
  const directoryDid = env.ATMOBB_EXTENSION_DIRECTORY_DID;
  if (!directoryDid) return { found: false };

  const rkey = endorsementRkey(gitUrl);
  const cacheKey = `${directoryDid}\u0000${rkey}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const running = inflight.get(cacheKey);
  if (running) return running;

  const lookup = (async (): Promise<RawEndorsement> => {
    try {
      if (directoryDid === FORUM_DID()) {
        const record = await getForumRecord(ENDORSEMENT_COLLECTION, rkey);
        const parsed = record && isObject(record.value) ? parseValue(record.uri, record.value) : null;
        return parsed ? { found: true, reviewed: parsed.reviewed, listing: parsed.listing } : { found: false };
      }
      return await fetchFromDirectoryPds(directoryDid, rkey);
    } catch (error) {
      // Never blocks an install: unresolvable DID, unreachable PDS, timeout,
      // or anything else reads as unverified, cached only briefly so a
      // transient failure doesn't add its timeout to every view until it clears.
      console.error('[extensions] endorsement lookup failed:', error instanceof OutboundFetchError ? error.code : error instanceof Error ? error.message : error);
      return { found: false, unavailable: true };
    }
  })()
    .then((raw) => {
      cacheSet(cacheKey, raw);
      return raw;
    })
    .finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, lookup);
  return lookup;
}

/** Whether the atmobb.app directory endorses `gitUrl`'s repository, and whether `sha` is among the SHAs staff reviewed. */
export async function endorsementFor(gitUrl: string, sha: string): Promise<EndorsementLookup> {
  const raw = await rawEndorsementFor(gitUrl);
  return raw.found ? { status: 'endorsed', reviewed: raw.reviewed.includes(sha), listing: raw.listing } : { status: 'unverified' };
}
