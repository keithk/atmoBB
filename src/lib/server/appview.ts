import { env } from '$env/dynamic/private';
import type { RichTextBlock } from '$lib/richtext/bbcode';
import { mintSessionCookie } from './happyview-session';
import { parseAtUri } from '$lib/appview-paths';
import type { Ban } from '$lib/standing';

const HV = () => env.HAPPYVIEW_URL ?? 'http://127.0.0.1:3000';
const CLIENT_KEY = () => env.HAPPYVIEW_CLIENT_KEY ?? '';
export const FORUM_DID = () => env.ATMOBB_FORUM_DID ?? 'did:plc:atmobbdevforum';

const NS = 'app.atmobb';
export const SESSION_COOKIE = 'happyview_session';

export interface SessionUser {
  did: string;
  handle: string;
}

const handleCache = new Map<string, { handle: string; at: number }>();

export async function resolveHandle(did: string): Promise<string> {
  const hit = handleCache.get(did);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.handle;
  let handle = did;
  try {
    const res = await fetch(`https://plc.directory/${did}`);
    if (res.ok) {
      const doc = (await res.json()) as { alsoKnownAs?: string[] };
      const aka = doc.alsoKnownAs?.find((a) => a.startsWith('at://'));
      if (aka) handle = aka.slice('at://'.length);
    }
  } catch {
    // leave handle = did on resolution failure
  }
  handleCache.set(did, { handle, at: Date.now() });
  return handle;
}

export type { RichTextBlock };

export interface ActorProfile {
  displayName?: string;
  description?: string;
  signature?: RichTextBlock[];
  title?: string;
  pronouns?: string;
  website?: string;
  /** Portable image avatar stored as a blob in the actor's repo. */
  avatar?: unknown;
  /** When the actor.profile record was first written — our best proxy for "member since". */
  createdAt?: string;
  /** Plugin-owned profile data is passed through without core interpreting it. */
  [key: string]: unknown;
}

export interface ForumFont {
  family: string;
  weight: number;
  style: string;
  source: unknown;
}

export interface ForumProfile {
  name: string;
  description?: string;
  ranks?: { title: string; minPosts: number }[];
  customCss?: string;
  customFonts?: ForumFont[];
  ogImage?: unknown;
  ogTheme?: string;
  [k: string]: unknown;
}

export interface LatestPost {
  uri: string;
  title: string;
  author: string;
  authorProfile?: ActorProfile;
  at: string;
  origin?: Origin;
}

/** Provenance of a merged-topic post: the forum whose board it lives on. */
export interface Origin {
  did: string;
  name?: string;
}

/** Board read-access as stored on the board record: absent/#public, or a #space ref. */
export type BoardAccess = { $type?: string; space?: string };

/** The backing permissioned-space URI if this board is members-only, else null. */
export function spaceOfBoard(access?: BoardAccess): string | null {
  return access && typeof access.space === 'string' ? access.space : null;
}

export interface BoardIndex {
  forum?: ForumProfile;
  boards: {
    uri: string;
    value: {
      name: string;
      description?: string;
      parent?: string;
      category?: string;
      topic?: string;
      topicFederation?: string;
      topicAllow?: string[];
      order?: number;
      access?: BoardAccess;
    };
    threadCount: number;
    replyCount: number;
    latestActivity?: string;
    latest?: LatestPost;
  }[];
  categories?: { uri: string; value: { name: string; order?: number } }[];
  stats?: {
    threads: number;
    posts: number;
    members: number;
    newestMember?: { did: string; at: string; displayName?: string };
  };
}

export interface LatestThreads {
  threads: {
    uri: string;
    board: string;
    boardName?: string;
    author: string;
    authorProfile?: ActorProfile;
    title: string;
    createdAt: string;
    replyCount: number;
    lastActivity: string;
    lastReplyBy?: string;
    origin?: Origin;
  }[];
  cursor?: string;
}

export interface ActivityStats {
  posts: number;
  topics: number;
  replies: number;
  lastActive?: string;
}

export interface MemberActivity {
  local: ActivityStats;
  global: ActivityStats & { forums: number };
  forums: (ActivityStats & { did: string; name?: string })[];
  recentThreads: {
    uri: string;
    board: string;
    boardName?: string;
    title: string;
    createdAt: string;
    replyCount: number;
    forum: { did: string; name?: string };
  }[];
}

export interface Members {
  members: {
    did: string;
    posts: number;
    profile?: ActorProfile;
    lastActive?: string;
  }[];
  cursor?: string;
}

export interface BoardThreads {
  board?: {
    name: string;
    description?: string;
    topic?: string;
    topicFederation?: string;
    topicAllow?: string[];
    access?: BoardAccess;
    threadCount: number;
    replyCount: number;
  };
  threads: {
    uri: string;
    cid?: string;
    board: string;
    author: string;
    authorProfile?: ActorProfile;
    title: string;
    createdAt: string;
    replyCount: number;
    lastActivity: string;
    lastReplyBy?: string;
    origin?: Origin;
    locked: boolean;
    /** Pinned on this board: a peer board's pins don't carry into a merged stream. */
    pinned: boolean;
  }[];
  cursor?: string;
}

/** A thread's embedded poll, as written on the thread record. */
export interface Poll {
  question?: string;
  options: string[];
  multipleChoice?: boolean;
  closesAt?: string;
}

/** The tally the appview computes from vote records. */
export interface PollResult {
  counts: number[];
  voters: number;
  /** Every vote record the viewer holds on this poll, counted or not. */
  viewerVotes: { uri: string; option: number }[];
  /** The options the viewer's counted votes chose. */
  viewerOptions: number[];
}

export interface ThreadPage {
  thread?: {
    uri: string;
    cid?: string;
    author: string;
    authorProfile?: ActorProfile;
    authorPosts: number;
    /** Across every indexed forum. Absent for space threads, which the public counters can't see. */
    authorTotalPosts?: number;
    value: {
      title: string;
      body?: RichTextBlock[];
      board: string;
      createdAt?: string;
      editedAt?: string;
      poll?: Poll;
    };
    /** Present when the thread's board belongs to another forum. */
    origin?: Origin & { federated: boolean };
    /** Hidden for the viewing forum: by its origin, or by this forum's own action. */
    hidden: boolean;
    locked: boolean;
    lockedAt?: string;
    pinned: boolean;
  };
  replies: {
    uri: string;
    cid?: string;
    author: string;
    authorProfile?: ActorProfile;
    authorPosts: number;
    authorTotalPosts?: number;
    value: {
      body?: RichTextBlock[];
      createdAt?: string;
      editedAt?: string;
      /** The post this reply answers, when it isn't just the thread. */
      parent?: { uri: string; cid: string };
    };
    indexedAt: string;
  }[];
  replyCount: number;
  /** Chronological position of the `reply` asked for, when it's in this thread. */
  replyIndex?: number;
  poll?: PollResult;
  cursor?: string;
}

class AppviewError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function xrpc<T>(
  method: 'GET' | 'POST',
  nsid: string,
  opts: { params?: Record<string, string>; body?: unknown; sessionCookie?: string } = {},
): Promise<T> {
  const url = new URL(`/xrpc/${nsid}`, HV());
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { 'X-Client-Key': CLIENT_KEY() };
  // Our cookie is deliberately DID-only (no Happyview OAuth-client key). Encode
  // the signed value so its base64 prefix is safe in the Cookie header.
  if (opts.sessionCookie) headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(opts.sessionCookie)}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppviewError(res.status, (data as { error?: string; message?: string }).message ?? (data as { error?: string }).error ?? `appview error ${res.status}`);
  }
  return data as T;
}

export const getBoardIndex = (forum: string) =>
  xrpc<BoardIndex>('GET', `${NS}.forum.getBoardIndex`, { params: { forum } });

/**
 * With PDS-first writes the appview only learns about a change once Jetstream
 * delivers it, a few seconds later. Poll `read` until `landed` sees the change
 * (true) or the deadline passes (false), so callers can hold a post-save
 * redirect until the page they land on is current.
 */
export async function awaitIndexed<T>(
  read: () => Promise<T>,
  landed: (data: T) => boolean,
  timeoutMs = 7000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (landed(await read())) return true;
    } catch {
      // transient appview hiccup — keep polling until the deadline
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

export const getBoardThreads = (board: string, cursor?: string, limit = 25) =>
  xrpc<BoardThreads>('GET', `${NS}.discussion.getBoardThreads`, {
    params: { board, limit: String(limit), ...(cursor ? { cursor } : {}) },
  });

export interface ThreadPageOptions {
  cursor?: string;
  limit?: number;
  forum?: string;
  /** A reply URI: fetch the page holding it rather than the cursor's page. */
  reply?: string;
  /** The reader's DID, for their own poll votes. */
  viewer?: string;
}

export const getThreadPage = (thread: string, opts: ThreadPageOptions = {}) =>
  xrpc<ThreadPage>('GET', `${NS}.discussion.getThreadPage`, {
    params: {
      thread,
      forum: opts.forum ?? FORUM_DID(),
      limit: String(opts.limit ?? 25),
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
      ...(opts.reply ? { reply: opts.reply } : {}),
      ...(opts.viewer ? { viewer: opts.viewer } : {}),
    },
  });

export const replyUri = (did: string, rkey: string) => `at://${did}/${NS}.discussion.reply/${rkey}`;

export const getLatestThreads = (cursor?: string, limit = 25, forum = FORUM_DID()) =>
  xrpc<LatestThreads>('GET', `${NS}.discussion.getLatestThreads`, {
    params: { forum, limit: String(limit), ...(cursor ? { cursor } : {}) },
  });

export const getMemberActivity = (actor: string, forum = FORUM_DID()) =>
  xrpc<MemberActivity>('GET', `${NS}.actor.getActivity`, { params: { actor, forum } });

export interface Staff {
  staff: {
    uri: string;
    subject: string;
    role: string;
    boards?: string[];
    createdAt: string;
    subjectProfile?: ActorProfile;
  }[];
}

export const getStaff = (forum = FORUM_DID()) =>
  xrpc<Staff>('GET', `${NS}.forum.getStaff`, { params: { forum } });

export interface AccessRequests {
  requests: {
    uri: string;
    requester: string;
    board: string;
    boardName?: string;
    reason?: string;
    createdAt: string;
    requesterProfile?: ActorProfile;
  }[];
}

export const getAccessRequests = (forum = FORUM_DID()) =>
  xrpc<AccessRequests>('GET', `${NS}.forum.getAccessRequests`, { params: { forum } });

export interface Topic {
  topic: string;
  totals?: { boards: number; forums: number; threads: number; posts: number };
  boards: {
    uri: string;
    name: string;
    description?: string;
    federation: string;
    forum: { did: string; name?: string };
    threadCount: number;
    replyCount: number;
    latestActivity?: string;
  }[];
}

export const getTopic = (topic: string) =>
  xrpc<Topic>('GET', `${NS}.forum.getTopic`, { params: { topic } });

export interface Topics {
  topics: {
    topic: string;
    boards: number;
    forums: number;
    threads: number;
    posts: number;
    latestActivity?: string;
  }[];
}

export const getTopics = () => xrpc<Topics>('GET', `${NS}.forum.getTopics`);

export interface ModerationLog {
  actions: {
    uri: string;
    value: {
      subject: { uri?: string; cid?: string; did?: string };
      action: string;
      board?: string;
      reason?: string;
    };
    createdAt: string;
    threadTitle?: string;
    subjectForumName?: string;
    /** Display name when the account subject is a member with a profile. */
    subjectName?: string;
  }[];
}

export interface Standing {
  bans: Ban[];
  warnings: { uri: string; board?: string; reason?: string; createdAt: string }[];
}

export const getStanding = (actor: string, forum = FORUM_DID()) =>
  xrpc<Standing>('GET', `${NS}.moderation.getStanding`, { params: { forum, actor } });

export const getModerationLog = (forum = FORUM_DID(), limit = 50) =>
  xrpc<ModerationLog>('GET', `${NS}.moderation.getLog`, {
    params: { forum, limit: String(limit) },
  });

export interface Directory {
  forums: { did: string; name: string; description?: string; createdAt: string }[];
}

export const getDirectory = () => xrpc<Directory>('GET', `${NS}.forum.getDirectory`);

export const getMembers = (cursor?: string, limit = 50, forum = FORUM_DID()) =>
  xrpc<Members>('GET', `${NS}.forum.getMembers`, {
    params: { forum, limit: String(limit), ...(cursor ? { cursor } : {}) },
  });

// --- Permissioned spaces (members-only boards) -------------------------------
// Space records live inside Happyview, gated by membership — off the public
// firehose, so none of the stats/Lua read path above applies to them. We act as
// a given DID by minting that member's happyview_session cookie (see
// ./happyview-session). The forum account is each space's authority.

/** The space type NSID backing every private board; one space per board, keyed by the board's rkey. */
export const SPACE_TYPE = `${NS}.forum.privateBoard`;

/** at:// URI of the space backing the board with this rkey in the forum's repo. */
export const spaceUriFor = (boardRkey: string, forumDid = FORUM_DID()) =>
  `at://${forumDid}/space/${SPACE_TYPE}/${boardRkey}`;

/**
 * The space URI a space *record* lives in, or null for a public record. Space
 * record URIs are at://<did>/space/<type>/<skey>/<author>/<collection>/<rkey>;
 * the first four path segments are the space itself.
 */
export function spaceUriOf(recordUri: string): string | null {
  const parts = recordUri.split('/');
  // ['at:', '', did, 'space', type, skey, author, collection, rkey]
  return parts[3] === 'space' && parts.length >= 6 ? parts.slice(0, 6).join('/') : null;
}

export const THREAD_NSID = `${NS}.discussion.thread`;
export const REPLY_NSID = `${NS}.discussion.reply`;

export interface ParsedSpaceRecord {
  space: string;
  author: string;
  collection: string;
  rkey: string;
  skey: string;
}

/** Break a space *record* URI into its parts, or null if it isn't one. */
export function parseSpaceUri(uri: string): ParsedSpaceRecord | null {
  const parts = uri.split('/');
  // ['at:', '', did, 'space', type, skey, author, collection, rkey]
  if (parts[3] !== 'space' || parts.length < 9) return null;
  return {
    space: parts.slice(0, 6).join('/'),
    skey: parts[5],
    author: parts[6],
    collection: parts[7],
    rkey: parts[8],
  };
}

/** Fetch a public (indexed) record's value by URI parts, or null if absent. */
export async function getPublicRecord<T = unknown>(
  repo: string,
  collection: string,
  rkey: string,
): Promise<T | null> {
  try {
    const res = await xrpc<{ value: T }>('GET', 'com.atproto.repo.getRecord', {
      params: { repo, collection, rkey },
    });
    return res.value;
  } catch {
    return null;
  }
}

/**
 * The permissioned-space URI backing a board, or null if the board is public.
 *
 * A board is private iff its space exists, so we ask Happyview directly rather
 * than reading the board record's `access` from the index — the index lags the
 * firehose and its `getRecord` is unreliable for our records, so a private
 * board could read as public and route the post to the author's PUBLIC repo,
 * leaking it. This check is authoritative and firehose-independent. It runs as
 * the board's forum (the space authority, which can always see its own space).
 *
 * Fails closed: only a genuine 404 (no space) counts as public. Any other error
 * is ambiguous and rethrown, so a transient failure blocks the write instead of
 * silently leaking a private post.
 */
export async function getBoardAccess(boardUri: string): Promise<string | null> {
  const p = parseAtUri(boardUri);
  if (!p) return null;
  const space = spaceUriFor(p.rkey, p.did);
  try {
    await xrpc('GET', 'com.atproto.space.getSpace', {
      params: { space },
      sessionCookie: mintSessionCookie(p.did),
    });
    return space;
  } catch (e) {
    if (e instanceof AppviewError && e.status === 404) return null;
    throw e;
  }
}

export type SpaceAccess = 'write' | 'read' | 'read_self';
export interface SpaceMember {
  did: string;
  access: SpaceAccess;
  isDelegation: boolean;
}
export interface SpaceRecordRef {
  cid: string;
  collection: string;
  rkey: string;
}

const forumCookie = () => mintSessionCookie(FORUM_DID());

/** Create the space for a board, authored by the forum account (auto write-member). Returns its URI. */
export async function createSpace(
  boardRkey: string,
  opts: { displayName?: string; description?: string } = {},
): Promise<string> {
  const res = await xrpc<{ uri: string }>('POST', 'com.atproto.simplespace.createSpace', {
    sessionCookie: forumCookie(),
    body: { type: SPACE_TYPE, skey: boardRkey, mintPolicy: 'member-list', ...opts },
  });
  return res.uri;
}

export const deleteSpace = (space: string) =>
  xrpc('POST', 'com.atproto.simplespace.deleteSpace', { sessionCookie: forumCookie(), body: { space } });

export const addSpaceMember = (space: string, did: string, access: SpaceAccess = 'write') =>
  xrpc('POST', 'com.atproto.simplespace.addMember', {
    sessionCookie: forumCookie(),
    body: { space, did, access, isDelegation: false },
  });

export const removeSpaceMember = (space: string, did: string) =>
  xrpc('POST', 'com.atproto.simplespace.removeMember', { sessionCookie: forumCookie(), body: { space, did } });

export async function listSpaceMembers(space: string): Promise<SpaceMember[]> {
  const res = await xrpc<{ members: { did: string; access: SpaceAccess; is_delegation?: boolean }[] }>(
    'GET',
    'com.atproto.simplespace.listMembers',
    { params: { space }, sessionCookie: forumCookie() },
  );
  return (res.members ?? []).map((m) => ({ did: m.did, access: m.access, isDelegation: !!m.is_delegation }));
}

/** Whether `did` can read/write the space (any membership level counts). */
export async function isSpaceMember(space: string, did: string): Promise<boolean> {
  try {
    const members = await listSpaceMembers(space);
    return members.some((m) => m.did === did);
  } catch {
    return false;
  }
}

/** Write a record into the space as `asDid` (must be a write-member). */
export const createSpaceRecord = (
  asDid: string,
  space: string,
  collection: string,
  record: Record<string, unknown>,
) =>
  xrpc<{ uri: string; cid: string }>('POST', 'com.atproto.space.createRecord', {
    sessionCookie: mintSessionCookie(asDid),
    body: { space, collection, record },
  });

/** Overwrite one of `asDid`'s own records in the space (an upsert by rkey). */
export const putSpaceRecord = (
  asDid: string,
  space: string,
  collection: string,
  rkey: string,
  record: Record<string, unknown>,
) =>
  xrpc<{ uri: string; cid: string }>('POST', 'com.atproto.space.putRecord', {
    sessionCookie: mintSessionCookie(asDid),
    body: { space, collection, rkey, record },
  });

/** Remove one of `asDid`'s own records from the space. */
export const deleteSpaceRecord = (asDid: string, space: string, collection: string, rkey: string) =>
  xrpc('POST', 'com.atproto.space.deleteRecord', {
    sessionCookie: mintSessionCookie(asDid),
    body: { space, collection, rkey },
  });

/** Authors (DIDs) that have written into the space, read as `asDid`. */
export async function listSpaceRepos(asDid: string, space: string): Promise<string[]> {
  const res = await xrpc<{ repos: { did: string }[] }>('GET', 'com.atproto.space.listRepos', {
    params: { space },
    sessionCookie: mintSessionCookie(asDid),
  });
  return (res.repos ?? []).map((r) => r.did);
}

/** One author's records of a collection in the space, read as `asDid`. listRecords without `repo` returns only the caller's own — so we always pass repo. */
export async function listSpaceRecords(
  asDid: string,
  space: string,
  repo: string,
  collection: string,
  limit = 100,
): Promise<SpaceRecordRef[]> {
  const res = await xrpc<{ records: SpaceRecordRef[] }>('GET', 'com.atproto.space.listRecords', {
    params: { space, repo, collection, limit: String(limit) },
    sessionCookie: mintSessionCookie(asDid),
  });
  return res.records ?? [];
}

/** Full record body from the space, read as `asDid`. */
export const getSpaceRecord = <T = unknown>(
  asDid: string,
  space: string,
  repo: string,
  collection: string,
  rkey: string,
) =>
  xrpc<{ uri: string; cid: string; value: T }>('GET', 'com.atproto.space.getRecord', {
    params: { space, repo, collection, rkey },
    sessionCookie: mintSessionCookie(asDid),
  });


export { parseAtUri, threadPath, boardPath } from '$lib/appview-paths';

export const boardUri = (rkey: string, did = FORUM_DID()) => `at://${did}/${NS}.forum.board/${rkey}`;
export const threadUri = (did: string, rkey: string) => `at://${did}/${NS}.discussion.thread/${rkey}`;
