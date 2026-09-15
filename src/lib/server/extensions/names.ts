import { isValidHandle } from '@atproto/syntax';
import { isObject } from '$lib/extensions/contract';
import type { NamesAnswer, PersonName } from '$lib/extensions/bridge';
import { profileForForum } from '$lib/profile-overrides';
import { FORUM_DID } from '$lib/server/appview';
import { beforeDeadline } from './deadline';
import { RateWindows } from './rate-window';
import { claimedHandle, didDocumentFor, handleDid, repoRecord } from './source';

// The names a panel shows people by. A panel knows people only as DIDs and
// its frame can't reach the network, so the page asks here for it. A handle
// counts only when it resolves back to the DID, checked the way a standalone
// page's source is, through the hardened fetcher; the display name is the
// member's actor profile as this forum shows it. Visitors reach this signed
// out, so lookups are counted per install and client address.

const ACTOR_PROFILE_COLLECTION = 'app.atmobb.actor.profile';
const ACTOR_PROFILE_RKEY = 'self';
/** The actor profile lexicon's own cap on a display name. */
const DISPLAY_NAME_MAX = 640;

export const NAMES_CACHE_MAX = 5_000;
const NAME_TTL_MS = 5 * 60_000;
/** An unresolved answer is retried sooner, so a PDS or DNS blip doesn't stick for five minutes. */
const UNRESOLVED_TTL_MS = 30_000;

/** Lookups one request runs at once. */
export const NAME_LOOKUP_CONCURRENCY = 8;
/** How long a request waits on its lookups before answering null for the ones still running. */
export const NAMES_ANSWER_MS = 8_000;

export const NAME_LOOKUPS_PER_CLIENT_PER_MINUTE = 30;
const MINUTE_MS = 60_000;
const CLIENT_WINDOWS_MAX = 5_000;

type Resolution<T> = { value: T; ttl: number };

/** A bounded cache, oldest out, whose concurrent lookups for one key share a resolution. `get` never throws. */
function lookupCache<T>(resolve: (key: string) => Promise<Resolution<T>>, unresolved: T) {
  const entries = new Map<string, { value: T; expires: number }>();
  const inflight = new Map<string, Promise<T>>();

  return {
    async get(key: string): Promise<T> {
      const hit = entries.get(key);
      if (hit && Date.now() < hit.expires) return hit.value;
      entries.delete(key);
      const running = inflight.get(key);
      if (running) return running;
      const lookup = resolve(key)
        .catch((): Resolution<T> => ({ value: unresolved, ttl: UNRESOLVED_TTL_MS }))
        .then(({ value, ttl }) => {
          entries.set(key, { value, expires: Date.now() + ttl });
          while (entries.size > NAMES_CACHE_MAX) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            entries.delete(oldest);
          }
          return value;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, lookup);
      return lookup;
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
      inflight.clear();
    },
  };
}

function displayNameOf(record: unknown): string | undefined {
  const profile = profileForForum(isObject(record) ? record : null, FORUM_DID());
  const name = typeof profile?.displayName === 'string' ? profile.displayName.trim().slice(0, DISPLAY_NAME_MAX) : '';
  return name || undefined;
}

async function resolveName(did: string): Promise<Resolution<PersonName | null>> {
  const doc = await didDocumentFor(did);
  const handle = doc && claimedHandle(doc);
  if (!doc || !handle) return { value: null, ttl: UNRESOLVED_TTL_MS };
  const [resolved, profile] = await Promise.all([handleDid(handle), repoRecord(did, doc, ACTOR_PROFILE_COLLECTION, ACTOR_PROFILE_RKEY)]);
  if (resolved !== did) return { value: null, ttl: UNRESOLVED_TTL_MS };
  const displayName = profile.status === 'found' ? displayNameOf(profile.value) : undefined;
  return { value: displayName ? { handle, displayName } : { handle }, ttl: profile.status === 'unavailable' ? UNRESOLVED_TTL_MS : NAME_TTL_MS };
}

async function resolveHandleDid(handle: string): Promise<Resolution<string | null>> {
  const did = await handleDid(handle);
  const doc = did && (await didDocumentFor(did));
  return doc && claimedHandle(doc) === handle ? { value: did, ttl: NAME_TTL_MS } : { value: null, ttl: UNRESOLVED_TTL_MS };
}

const names = lookupCache(resolveName, null);
const handleDids = lookupCache(resolveHandleDid, null);

/** A handle as asked for, lowercased and without its leading `@`, or null when it isn't a usable handle. */
export function normalizeHandle(value: string): string | null {
  const handle = (value.startsWith('@') ? value.slice(1) : value).toLowerCase();
  return isValidHandle(handle) && !handle.endsWith('.invalid') ? handle : null;
}

/**
 * Names for `dids` and DIDs for `handles`, keyed exactly as asked. Lookups run
 * a few at a time; once `NAMES_ANSWER_MS` passes, the ones still running or
 * not yet started answer null, so one slow account never sinks the rest.
 * Never throws.
 */
export async function lookupNames(dids: string[], handles: string[]): Promise<NamesAnswer> {
  const named = new Map<string, PersonName | null>();
  const found = new Map<string, string | null>();
  const jobs = [
    ...[...new Set(dids)].map((did) => async () => void named.set(did, await names.get(did))),
    ...[...new Set(handles)].map((asked) => async () => {
      const handle = normalizeHandle(asked);
      found.set(asked, handle ? await handleDids.get(handle) : null);
    }),
  ];

  const deadline = Date.now() + NAMES_ANSWER_MS;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && Date.now() < deadline) await jobs[next++]();
  };
  const workers = Promise.all(Array.from({ length: Math.min(NAME_LOOKUP_CONCURRENCY, jobs.length) }, worker));
  await beforeDeadline(workers, NAMES_ANSWER_MS, () => new Error('Name lookups ran out of time.')).catch(() => {});

  return {
    names: Object.fromEntries(dids.map((did) => [did, named.get(did) ?? null])),
    dids: Object.fromEntries(handles.map((handle) => [handle, found.get(handle) ?? null])),
  };
}

// --- rate limit (per install and client address, sliding minute) ----------------

const clientWindows = new RateWindows(CLIENT_WINDOWS_MAX);

/** Take one of a client's name lookups on an install for this minute, or false when they've used them all. */
export function takeNameLookup(install: string, client: string, now = Date.now()): boolean {
  return clientWindows.take(`${install} ${client}`, NAME_LOOKUPS_PER_CLIENT_PER_MINUTE, MINUTE_MS, now);
}

// --- test seams -------------------------------------------------------------------

/** Test-only: the name and handle caches' entry counts. */
export const namesCacheSizesForTests = () => ({ names: names.size, handles: handleDids.size });

export function resetNamesForTests() {
  names.clear();
  handleDids.clear();
  clientWindows.clear();
}
