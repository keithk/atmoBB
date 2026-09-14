import { env } from '$env/dynamic/private';
import type { RichTextBlock } from '$lib/richtext/bbcode';
import { mintSessionCookie } from './happyview-session';
import { parseAtUri } from '$lib/appview-paths';
import type { Ban } from '$lib/standing';
import { profileForForum } from '$lib/profile-overrides';

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
  /** Fields written by other apps are passed through without core interpreting them. */
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
  /** Rich welcome shown in the home page hero under the description. */
  intro?: RichTextBlock[];
  homepage?: {
    layout?: string;
    sidebar?: boolean;
    welcome?: string;
    featuredThreads?: string[];
  };
  favicon?: unknown;
  theme?: string;
  customCss?: string;
  customFonts?: ForumFont[];
  ogImage?: unknown;
  ogTheme?: string;
  /** Join policy (app.atmobb.forum.profile#membership); absent means open. */
  membership?: ForumMembershipSettings;
  /** Hide the "powered by atmobb" footer badge. Absent means shown. */
  hideCredit?: boolean;
  [k: string]: unknown;
}

/** The profile's join policy. Absent means open. */
export interface ForumMembershipSettings {
  mode?: string;
  prompt?: string;
  inviteCap?: number;
  inviteDays?: number;
  gatedSince?: string;
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
      color?: string;
      emoji?: string;
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

export interface ThreadParticipant {
  did: string;
  profile?: ActorProfile;
}

export interface ThreadSummary {
  uri: string;
  board: string;
  boardName?: string;
  author: string;
  authorProfile?: ActorProfile;
  title: string;
  tags?: string[];
  createdAt: string;
  replyCount: number;
  lastActivity: string;
  lastReplyBy?: string;
  /** Author first, then up to four distinct recent visible participants. */
  participants?: ThreadParticipant[];
  origin?: Origin;
}

export interface LatestThreads {
  threads: ThreadSummary[];
  cursor?: string;
}

/** The appview also returns per-forum post counts here; the app reads only
 *  the timestamps and the recent-topics list. */
export interface MemberActivity {
  local: { lastActive?: string };
  global: { lastActive?: string };
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

/** How a stamp is drawn: two hex colors and one of a bounded set of shapes. */
export interface StampLook {
  bg: string;
  ink: string;
  shape: string;
}

/** What earns an admin-defined stamp; the field matching `kind` is set. */
export interface StampTrigger {
  kind: string;
  board?: string;
  before?: string;
  via?: string;
}

/**
 * One stamp a member holds on a forum. `id` is the stamp record's at-uri for
 * an admin stamp or a fixed id for a generated one (`atmobb:board:<uri>`,
 * `atmobb:arrival`, `atmobb:first-light`, `atmobb:early-days`).
 */
export interface TrayEntry {
  id: string;
  name: string;
  /** admin (trigger matched), default (board or arrival), network, or byHand. */
  source: string;
  /** Present for admin and network stamps; board and arrival defaults are drawn by the app. */
  look?: StampLook;
  uri?: string;
  cid?: string;
  /** For a board default: the board and its color, when it has one. */
  board?: string;
  boardColor?: string;
  /** For an arrival default: how the member was accepted and by whom. */
  via?: string;
  sponsor?: string;
}

export interface Members {
  members: {
    did: string;
    profile?: ActorProfile;
    lastActive?: string;
    /** When the member arrived: the acceptance on a gated forum, the declaration on an open one. */
    since?: string;
    /** On a gated forum, who brought them in. */
    sponsor?: string;
    /** invite, application, or founding. */
    via?: string;
    /** The stamps the member wears on this forum, in order, at most three. */
    stamps: TrayEntry[];
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
  threads: (ThreadSummary & {
    cid?: string;
    locked: boolean;
    /** Pinned on this board: a peer board's pins don't carry into a merged stream. */
    pinned: boolean;
  })[];
  /** Number matching q/tag when filtered; board.threadCount remains the unfiltered total. */
  filteredCount?: number;
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
    /** The stamps the author wears on the viewing forum, in order, at most three. */
    authorStamps: TrayEntry[];
    value: {
      title: string;
      body?: RichTextBlock[];
      tags?: string[];
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
    /** The stamps the author wears on the viewing forum, in order, at most three. */
    authorStamps: TrayEntry[];
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

/** Indexed responses embed raw actor records in lists, participants, and posts. */
function resolveProfiles(value: unknown, forum: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) resolveProfiles(item, forum);
    return;
  }
  const object = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(object)) {
    if (['authorProfile', 'subjectProfile', 'requesterProfile', 'profile'].includes(key)) {
      object[key] = profileForForum(child as ActorProfile | null, forum);
    } else if (!['value', 'record', 'body', 'forum'].includes(key)) {
      resolveProfiles(child, forum);
    }
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
  resolveProfiles(data, opts.params?.forum ?? FORUM_DID());
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

export interface ThreadQueryOptions {
  q?: string;
  board?: string;
  tag?: string;
  uri?: string;
}

export const getBoardThreads = (
  board: string,
  cursor?: string,
  limit = 25,
  filters: Pick<ThreadQueryOptions, 'q' | 'tag'> = {},
) =>
  xrpc<BoardThreads>('GET', `${NS}.discussion.getBoardThreads`, {
    params: {
      board,
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.tag ? { tag: filters.tag } : {}),
    },
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

export const getLatestThreads = (
  cursor?: string,
  limit = 25,
  forum = FORUM_DID(),
  filters: ThreadQueryOptions = {},
) =>
  xrpc<LatestThreads>('GET', `${NS}.discussion.getLatestThreads`, {
    params: {
      forum,
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.board ? { board: filters.board } : {}),
      ...(filters.tag ? { tag: filters.tag } : {}),
      ...(filters.uri ? { uri: filters.uri } : {}),
    },
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
  cursor?: string;
}

/** Applications to join the forum itself (kind=forum), one per applicant. */
export interface ForumApplications {
  requests: {
    uri: string;
    cid?: string;
    requester: string;
    reason?: string;
    createdAt: string;
    requesterProfile?: ActorProfile;
    /** From the newest forum-level decision since the application; accepted ones are not listed. */
    state: 'pending' | 'waiting' | 'denied';
  }[];
  cursor?: string;
}

export type AccessRequestKind = 'board' | 'forum';

export interface AccessRequestOptions<K extends AccessRequestKind = 'board'> {
  kind?: K;
  limit?: number;
  cursor?: string;
  /** With kind forum: only this account's application. */
  requester?: string;
}

export const getAccessRequests = <K extends AccessRequestKind = 'board'>(
  forum = FORUM_DID(),
  opts: AccessRequestOptions<K> = {},
) =>
  xrpc<K extends 'forum' ? ForumApplications : AccessRequests>('GET', `${NS}.forum.getAccessRequests`, {
    params: {
      forum,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.limit ? { limit: String(opts.limit) } : {}),
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
      ...(opts.requester ? { requester: opts.requester } : {}),
    },
  });

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
      /** acceptMember: who brought the subject in, and how. */
      sponsor?: string;
      via?: string;
      /** gateForum: the join mode entered. */
      mode?: string;
      /** The accessRequest a membership decision answers, or the stamp an awardStamp / revokeStamp names. */
      ref?: { uri: string; cid: string };
      /** The staff member who acted, when the record says so. */
      actor?: string;
    };
    createdAt: string;
    threadTitle?: string;
    subjectForumName?: string;
    /** Display name when the account subject is a member with a profile. */
    subjectName?: string;
    /** For awardStamp / revokeStamp: the stamp's name, while its record exists. */
    stampName?: string;
  }[];
}

export interface Standing {
  bans: Ban[];
  warnings: { uri: string; board?: string; reason?: string; createdAt: string }[];
}

export const getStanding = (actor: string, forum = FORUM_DID()) =>
  xrpc<Standing>('GET', `${NS}.moderation.getStanding`, { params: { forum, actor } });

/** moderation: hide/lock/pin/ban/warn/block and their reversals, plus awardStamp/revokeStamp; membership: acceptances, revocations, holds, access grants and denials, gate/open. */
export type ModerationFamily = 'moderation' | 'membership';

export const getModerationLog = (forum = FORUM_DID(), limit = 50, family?: ModerationFamily) =>
  xrpc<ModerationLog>('GET', `${NS}.moderation.getLog`, {
    params: { forum, limit: String(limit), ...(family ? { family } : {}) },
  });

/** One account's standing with a gated forum, derived from its acceptMember / revokeMember actions. */
export interface Membership {
  /** An acceptance window is open right now. */
  accepted: boolean;
  /** From the newest window, open or closed, so a removed member still reports their last sponsor. */
  since?: string;
  sponsor?: string;
  via?: string;
  /** Currently accepted members this account sponsored. */
  sponsored: { did: string; since: string; via?: string }[];
  /** Every stamp the actor holds on this forum. */
  tray: TrayEntry[];
  /** Ids from the tray the actor wears, in order, at most three. */
  worn: string[];
}

export const getMembership = (actor: string, forum = FORUM_DID()) =>
  xrpc<Membership>('GET', `${NS}.forum.getMembership`, { params: { forum, actor } });

export interface Stamps {
  /** The forum's stamp records, minus any firstPostInBoard stamp whose board is gone. */
  stamps: { uri: string; cid: string; name: string; look: StampLook; trigger: StampTrigger; createdAt: string }[];
  /** The network set every forum offers: first light and early days. */
  network: { id: string; name: string; look: StampLook }[];
  /** Present when `actor` was given. */
  tray?: TrayEntry[];
  worn?: string[];
}

export const getStamps = (forum = FORUM_DID(), actor?: string) =>
  xrpc<Stamps>('GET', `${NS}.forum.getStamps`, { params: { forum, ...(actor ? { actor } : {}) } });

export interface Directory {
  forums: { did: string; name: string; description?: string; createdAt: string }[];
}

export const getDirectory = () => xrpc<Directory>('GET', `${NS}.forum.getDirectory`);

interface Watchers {
  watchers: { did: string }[];
  cursor?: string;
}

/** Every watcher of a board, paged through to the end; banned members are already left out. */
export async function getWatchers(forum: string, board: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page: Watchers = await xrpc<Watchers>('GET', `${NS}.forum.getWatchers`, {
      params: { forum, board, limit: '100', ...(cursor ? { cursor } : {}) },
    });
    out.push(...(page.watchers ?? []).map((w) => w.did));
    cursor = page.cursor;
  } while (cursor);
  return out;
}

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
