import {
  getMemberActivity,
  getBoardIndex,
  FORUM_DID,
  type ActorProfile,
  type MemberActivity,
} from './appview';
import { presenceSnapshot } from './presence';
import type { Rank } from '$lib/rank';
import { blobCid } from '$lib/avatar/profile-image';

export { blobCid } from '$lib/avatar/profile-image';

const PLC = 'https://plc.directory';
const BSKY_API = 'https://public.api.bsky.app';
const NS = 'app.atmobb';
const ACTOR_PROFILE = `${NS}.actor.profile`;
const TTL = 5 * 60 * 1000;

export type Presence = 'online' | 'idle' | 'offline';

export interface Identity {
  did: string;
  handle: string;
  pds?: string;
}

export interface BskyProfile {
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
}

/** Another atproto app the DID publishes into — surfaced as "Elsewhere". */
export interface AtmosphereApp {
  nsid: string;
  label: string;
  icon: string;
  url?: string;
}

/** A recent post from the account's Bluesky feed. */
export interface BskyPost {
  uri: string;
  url: string;
  text: string;
  createdAt: string;
  replyCount: number;
  repostCount: number;
  likeCount: number;
}

export interface Elsewhere {
  bsky?: BskyProfile;
  apps: AtmosphereApp[];
  posts: BskyPost[];
}

// --- caches (per-DID, briefly) ----------------------------------------------

const docCache = new Map<string, { doc: { handle: string; pds?: string }; at: number }>();
const profileCache = new Map<string, { profile: ActorProfile | null; at: number }>();
const activityCache = new Map<string, { activity: MemberActivity; at: number }>();
const elsewhereCache = new Map<string, { elsewhere: Elsewhere; at: number }>();

function fresh<T>(hit: { at: number } | undefined): hit is T & { at: number } {
  return !!hit && Date.now() - hit.at < TTL;
}

// --- identity ---------------------------------------------------------------

/** Read the DID document once: handle (alsoKnownAs) + PDS service endpoint. */
async function resolveDidDoc(did: string): Promise<{ handle: string; pds?: string }> {
  const hit = docCache.get(did);
  if (fresh(hit)) return hit.doc;
  let handle = did;
  let pds: string | undefined;
  try {
    const res = await fetch(`${PLC}/${did}`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const doc = (await res.json()) as {
        alsoKnownAs?: string[];
        service?: { id?: string; type?: string; serviceEndpoint?: string }[];
      };
      const aka = doc.alsoKnownAs?.find((a) => a.startsWith('at://'));
      if (aka) handle = aka.slice('at://'.length);
      const svc = doc.service?.find(
        (s) => s.id?.endsWith('#atproto_pds') || s.type === 'AtprotoPersonalDataServer',
      );
      pds = svc?.serviceEndpoint;
    }
  } catch {
    // leave defaults; the profile still renders with the DID as its handle
  }
  const doc = { handle, pds };
  docCache.set(did, { doc, at: Date.now() });
  return doc;
}

/** The account's PDS service endpoint (from its DID doc), cached; undefined if unresolvable. */
export async function pdsFor(did: string): Promise<string | undefined> {
  return (await resolveDidDoc(did)).pds;
}

/** A public getBlob URL for a blob on `did`'s PDS, or undefined if the PDS is unknown. */
export async function blobUrl(did: string, cid: string): Promise<string | undefined> {
  const pds = await pdsFor(did);
  if (!pds) return undefined;
  return `${pds.replace(/\/$/, '')}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
}

async function handleToDid(handle: string): Promise<string | null> {
  const h = handle.replace(/^@/, '');
  // The handle's own server is authoritative; fall back to the public appview.
  try {
    const res = await fetch(`https://${h}/.well-known/atproto-did`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const did = (await res.text()).trim();
      if (did.startsWith('did:')) return did;
    }
  } catch {
    // custom domains without the well-known — try the appview resolver
  }
  try {
    const res = await fetch(
      `${BSKY_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(h)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const j = (await res.json()) as { did?: string };
      if (j.did) return j.did;
    }
  } catch {
    // unresolvable handle
  }
  return null;
}

// @-mention resolution is cached: the same handle recurs across posts, and a
// miss otherwise costs two network round-trips on every compose.
const mentionDidCache = new Map<string, { did: string | null; at: number }>();

/** Resolve a mentioned handle to a DID (cached ~1h), or null if unresolvable. */
export async function resolveMentionDid(handle: string): Promise<string | null> {
  const key = handle.toLowerCase();
  const hit = mentionDidCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.did;
  const did = await handleToDid(handle);
  mentionDidCache.set(key, { did, at: Date.now() });
  return did;
}

/** Turn a URL segment (a DID or a handle) into a full identity, or null. */
export async function resolveActor(actor: string): Promise<Identity | null> {
  const raw = decodeURIComponent(actor).replace(/^@/, '');
  const did = raw.startsWith('did:') ? raw : await handleToDid(raw);
  if (!did) return null;
  const doc = await resolveDidDoc(did);
  return { did, handle: doc.handle, pds: doc.pds };
}

// --- global identity (from the member's PDS) --------------------------------

/** The member's actor.profile record, read straight from their PDS (public, unauthed). */
export async function getPublicProfile(did: string, pds?: string): Promise<ActorProfile | null> {
  const hit = profileCache.get(did);
  if (fresh(hit)) return hit.profile;
  const endpoint = pds ?? (await resolveDidDoc(did)).pds;
  let profile: ActorProfile | null = null;
  if (endpoint) {
    try {
      const url = new URL(`${endpoint}/xrpc/com.atproto.repo.getRecord`);
      url.searchParams.set('repo', did);
      url.searchParams.set('collection', ACTOR_PROFILE);
      url.searchParams.set('rkey', 'self');
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const j = (await res.json()) as { value?: ActorProfile };
        profile = j.value ?? null;
      }
    } catch {
      // PDS unreachable — fall through with a null profile
    }
  }
  profileCache.set(did, { profile, at: Date.now() });
  return profile;
}

// --- public atmobb participation --------------------------------------------

const emptyActivity = (): MemberActivity => ({
  local: { posts: 0, topics: 0, replies: 0 },
  global: { posts: 0, topics: 0, replies: 0, forums: 0 },
  forums: [],
  recentThreads: [],
});

/** Exact public activity on this forum and across every indexed atmobb forum. */
export async function getAtmobbActivity(did: string, forum = FORUM_DID()): Promise<MemberActivity> {
  const key = `${did}:${forum}`;
  const hit = activityCache.get(key);
  if (fresh(hit)) return hit.activity;
  let activity: MemberActivity;
  try {
    activity = await getMemberActivity(did, forum);
  } catch {
    activity = emptyActivity();
  }
  activityCache.set(key, { activity, at: Date.now() });
  return activity;
}

// --- the wider atmosphere ---------------------------------------------------

// Other atproto apps we recognize by collection NSID. Bluesky and atmobb itself
// are handled separately, so they're deliberately absent here.
const KNOWN_APPS: { match: (nsid: string) => boolean; label: string; icon: string; url?: (h: string) => string }[] = [
  { match: (n) => n === 'com.whtwnd.blog.entry', label: 'WhiteWind', icon: '📝', url: (h) => `https://whtwnd.com/${h}` },
  { match: (n) => n.startsWith('blue.linkat.'), label: 'Linkat', icon: '🔗', url: (h) => `https://linkat.blue/${h}` },
  { match: (n) => n.startsWith('com.shinolabs.pinksea.'), label: 'PinkSea', icon: '🎨' },
  { match: (n) => n.startsWith('events.smokesignal.'), label: 'Smoke Signal', icon: '📅' },
  { match: (n) => n.startsWith('fyi.unravel.frontpage.') || n.startsWith('com.frontpage.'), label: 'Frontpage', icon: '📰' },
  { match: (n) => n.startsWith('xyz.statusphere.'), label: 'Statusphere', icon: '✨' },
  { match: (n) => n.startsWith('actor.rpg.') || n.startsWith('rpg.actor.'), label: 'rpg.actor', icon: '🎲' },
];

export async function getBskyProfile(did: string): Promise<BskyProfile | undefined> {
  try {
    const res = await fetch(
      `${BSKY_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return undefined;
    const j = (await res.json()) as {
      handle?: string;
      displayName?: string;
      avatar?: string;
      description?: string;
    };
    if (!j.handle) return undefined;
    return { handle: j.handle, displayName: j.displayName, avatar: j.avatar, description: j.description };
  } catch {
    return undefined;
  }
}

/** The account's own recent Bluesky posts (no replies, no reposts). */
export async function getBskyPosts(did: string, handle: string, limit = 3): Promise<BskyPost[]> {
  try {
    const url = new URL(`${BSKY_API}/xrpc/app.bsky.feed.getAuthorFeed`);
    url.searchParams.set('actor', did);
    // over-fetch: reposts/pins are filtered out below, so grab extra to fill `limit`.
    url.searchParams.set('limit', String(Math.min(limit * 4, 30)));
    url.searchParams.set('filter', 'posts_no_replies');
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      feed?: {
        reason?: unknown;
        post?: {
          uri: string;
          author?: { did?: string };
          record?: { text?: string; createdAt?: string };
          indexedAt?: string;
          replyCount?: number;
          repostCount?: number;
          likeCount?: number;
        };
      }[];
    };
    const out: BskyPost[] = [];
    for (const item of j.feed ?? []) {
      if (item.reason) continue; // skip reposts and pins
      const post = item.post;
      if (!post || post.author?.did !== did) continue;
      const rkey = post.uri.split('/').pop();
      out.push({
        uri: post.uri,
        url: `https://bsky.app/profile/${handle}/post/${rkey}`,
        text: post.record?.text ?? '',
        createdAt: post.record?.createdAt ?? post.indexedAt ?? '',
        replyCount: post.replyCount ?? 0,
        repostCount: post.repostCount ?? 0,
        likeCount: post.likeCount ?? 0,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function getKnownApps(did: string, pds?: string, handle?: string): Promise<AtmosphereApp[]> {
  const endpoint = pds ?? (await resolveDidDoc(did)).pds;
  if (!endpoint) return [];
  let collections: string[] = [];
  try {
    const res = await fetch(
      `${endpoint}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) collections = ((await res.json()) as { collections?: string[] }).collections ?? [];
  } catch {
    return [];
  }
  const apps: AtmosphereApp[] = [];
  const seen = new Set<string>();
  for (const nsid of collections) {
    const known = KNOWN_APPS.find((k) => k.match(nsid));
    if (known && !seen.has(known.label)) {
      seen.add(known.label);
      apps.push({ nsid, label: known.label, icon: known.icon, url: handle ? known.url?.(handle) : undefined });
    }
  }
  return apps;
}

/** Bluesky presence + recognized atproto apps, for the "Elsewhere" module. */
export async function getElsewhere(did: string, pds?: string, handle?: string): Promise<Elsewhere> {
  const hit = elsewhereCache.get(did);
  if (fresh(hit)) return hit.elsewhere;
  const [bsky, apps, posts] = await Promise.all([
    getBskyProfile(did),
    getKnownApps(did, pds, handle),
    handle ? getBskyPosts(did, handle) : Promise.resolve([]),
  ]);
  const elsewhere = { bsky, apps, posts };
  elsewhereCache.set(did, { elsewhere, at: Date.now() });
  return elsewhere;
}

// --- presence ---------------------------------------------------------------

// This forum's rank ladder, cached so hovercards don't re-hit the board index.
let ranksCache: { ranks: Rank[]; at: number } | null = null;

export async function getForumRanks(): Promise<Rank[]> {
  if (ranksCache && Date.now() - ranksCache.at < TTL) return ranksCache.ranks;
  let ranks: Rank[] = [];
  try {
    const index = await getBoardIndex(FORUM_DID());
    ranks = index.forum?.ranks ?? [];
  } catch {
    // board index unreachable — no ladder means no rank, which is fine
  }
  ranksCache = { ranks, at: Date.now() };
  return ranks;
}

export function presenceFor(did: string): Presence {
  const snap = presenceSnapshot();
  return snap.members.find((m) => m.did === did)?.presence ?? 'offline';
}

/** Drop the cached public profile for a DID — call after they edit their own. */
export function bustProfileCache(did: string): void {
  profileCache.delete(did);
}

export const forumDid = FORUM_DID;
