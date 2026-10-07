import { jsonToLex } from '@atproto/api';
import { agentFor } from './atproto-oauth';
import { withBoardWrite } from './board-write-lock';
import { parseAtUri } from '$lib/appview-paths';
import { PROFILE_FIELDS, forumProfileOverride, type ForumProfileOverride, type ProfileField } from '$lib/profile-overrides';
import { planUnwatch, planWatch, watchesForForum, type Watch } from '$lib/watch';
import type { Poll, RichTextBlock } from './appview';
import {
  createSpaceRecord,
  deleteSpaceRecord,
  getBoardAccess,
  getSpaceRecord,
  putSpaceRecord,
  spaceUriOf,
} from './appview';
import { bustProfileCache } from './profiles';
import { MAX_PINS } from '$lib/profile-page';

const NS = 'app.atmobb';
const MEMBERSHIP = `${NS}.forum.membership`;
const ACTOR_PROFILE = `${NS}.actor.profile`;
const ACCESS_REQUEST = `${NS}.forum.accessRequest`;
const WATCH = `${NS}.forum.watch`;

// Membership and watches are read from the member's own PDS (authoritative,
// no index lag) and cached briefly so the layout doesn't hit the PDS on every
// page load. A failed read is not cached and reads as null.
const CACHE_MS = 5 * 60 * 1000;

async function cached<T>(
  cache: Map<string, { value: T; at: number }>,
  key: string,
  load: () => Promise<T>,
): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    const value = await load();
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    // PDS unreachable or session dead — pages render without this state
    return null;
  }
}

const membershipCache = new Map<string, { value: Membership; at: number }>();

export interface Membership {
  joined: boolean;
  uri?: string;
}

/** The member's declaration record for `forum`, read live from their PDS. */
async function findDeclaration(did: string, forum: string): Promise<{ uri: string; value: Record<string, unknown> } | null> {
  const agent = await agentFor(did);
  const res = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: MEMBERSHIP,
    limit: 100,
  });
  const rec = res.data.records.find((r) => (r.value as { forum?: string }).forum === forum);
  return rec ? { uri: rec.uri, value: rec.value as Record<string, unknown> } : null;
}

export async function getMembership(did: string, forum: string): Promise<Membership | null> {
  return cached(membershipCache, did, async () => {
    const rec = await findDeclaration(did, forum);
    return { joined: !!rec, uri: rec?.uri };
  });
}

export async function joinForum(did: string, forum: string, fields: Record<string, unknown> = {}): Promise<void> {
  const agent = await agentFor(did);
  await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: MEMBERSHIP,
    record: { $type: MEMBERSHIP, forum, ...fields, createdAt: new Date().toISOString() },
  });
  membershipCache.delete(did);
}

// One membership write per did at a time: without this, two concurrent saves
// from a member with no declaration (a double submit, or a `move` right
// after a `save`) both see none from findDeclaration and both create one,
// leaving two membership records behind that a later Leave only clears one
// of. Queued so a concurrent call waits for the one ahead of it and then
// re-reads the declaration it created, instead of racing to create its own.
const patchingMembership = new Map<string, Promise<void>>();

/** Fields to set, or a function of the current declaration (empty when there is none) returning them, or null to write nothing. */
type MembershipPatch = Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown> | null);

/**
 * Set fields on the member's declaration for this forum. Without a
 * declaration (an open forum, never joined by hand) one is created carrying
 * the fields; leaving deletes it and them with it. Other fields on the record
 * are kept, and a field set to undefined is removed. A function patch reads
 * the declaration inside the queue, so a change built on the current value
 * can't race another write.
 */
function patchMembership(did: string, forum: string, fields: MembershipPatch): Promise<void> {
  const ahead = patchingMembership.get(did) ?? Promise.resolve();
  const write: Promise<void> = ahead
    .catch(() => {})
    .then(() => writeMembership(did, forum, fields))
    .finally(() => {
      if (patchingMembership.get(did) === write) patchingMembership.delete(did);
    });
  patchingMembership.set(did, write);
  return write;
}

async function writeMembership(did: string, forum: string, patch: MembershipPatch): Promise<void> {
  const current = await findDeclaration(did, forum);
  const fields = typeof patch === 'function' ? patch(current?.value ?? {}) : patch;
  if (!fields) return;
  const record: Record<string, unknown> = { ...current?.value, ...fields, $type: MEMBERSHIP };
  for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
  if (!current) return joinForum(did, forum, record);
  const p = parseAtUri(current.uri);
  if (!p) throw new Error('membership record has no usable uri');
  const agent = await agentFor(did);
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: MEMBERSHIP,
    rkey: p.rkey,
    record,
  });
  membershipCache.delete(did);
}

/** Set the stamps the member wears on this forum: the `wearing` field on their declaration (KTD3). */
export function setWearing(did: string, forum: string, wearing: string[]): Promise<void> {
  return patchMembership(did, forum, { wearing });
}

/** The topics the member pinned to their profile page on this forum, read from their declaration. */
export async function getPinned(did: string, forum: string): Promise<string[]> {
  const pinned = (await findDeclaration(did, forum))?.value.pinned;
  return Array.isArray(pinned) ? pinned.filter((uri): uri is string => typeof uri === 'string') : [];
}

// --- Guestbook --------------------------------------------------------------
// The owner's guestbook choices live on their membership declaration for the
// forum: whether it is open, the periods it was closed, and the entries and
// signers they hid. The entries themselves are records in the signers' repos.

const GUESTBOOK = `${NS}.actor.guestbook`;
/** The membership lexicon's caps on the closed periods and the hidden and blocked lists. */
const GUESTBOOK_PERIODS = 20;
const GUESTBOOK_LIST_MAX = 500;
/** The start of the period closing a guestbook before it was first opened, so older entries never show. */
const BEGINNING = '1970-01-01T00:00:00.000Z';

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function closedPeriods(value: unknown): { from: string; to?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((period) =>
    period && typeof period.from === 'string'
      ? [typeof period.to === 'string' ? { from: period.from, to: period.to } : { from: period.from }]
      : [],
  );
}

/**
 * Open or close the member's guestbook on this forum. Closing starts an
 * open-ended closed period; opening ends it, or the first time records one
 * from the beginning of time so entries signed before never show. Past the
 * cap the oldest periods merge into one, so nothing they hid
 * resurfaces. Asking for the state it is already in writes nothing.
 */
export function setGuestbookOpen(did: string, forum: string, open: boolean): Promise<void> {
  return patchMembership(did, forum, (current) => {
    if ((current.guestbook === true) === open) return null;
    const now = new Date().toISOString();
    const periods = closedPeriods(current.guestbookClosed);
    if (open) {
      const last = periods.at(-1);
      // No open period to end (the first opening, or a flag cleared by hand): close the gap since the last one.
      if (last && !last.to) last.to = now;
      else periods.push({ from: last?.to ?? BEGINNING, to: now });
    } else {
      periods.push({ from: now });
    }
    // Merging the oldest two keeps the earliest covered instant in place. It also hides
    // the open gap between them, so very old notes signed while it was open stop showing.
    while (periods.length > GUESTBOOK_PERIODS) {
      periods.splice(0, 2, { from: periods[0].from, to: periods[1].to });
    }
    return { guestbook: open || undefined, guestbookClosed: periods };
  });
}

/** Add or remove one value on a guestbook list, oldest dropping off past the cap; an empty list is removed. */
function patchGuestbookList(did: string, forum: string, field: 'guestbookHidden' | 'guestbookBlocked', value: string, add: boolean) {
  return patchMembership(did, forum, (current) => {
    const list = strings(current[field]);
    if (list.includes(value) === add) return null;
    const next = add ? [...list, value].slice(-GUESTBOOK_LIST_MAX) : list.filter((entry) => entry !== value);
    return { [field]: next.length ? next : undefined };
  });
}

export const hideGuestbookEntry = (did: string, forum: string, uri: string) => patchGuestbookList(did, forum, 'guestbookHidden', uri, true);
export const unhideGuestbookEntry = (did: string, forum: string, uri: string) => patchGuestbookList(did, forum, 'guestbookHidden', uri, false);
export const blockGuestbookSigner = (did: string, forum: string, signer: string) => patchGuestbookList(did, forum, 'guestbookBlocked', signer, true);
export const unblockGuestbookSigner = (did: string, forum: string, signer: string) => patchGuestbookList(did, forum, 'guestbookBlocked', signer, false);

export interface GuestbookSettings {
  open: boolean;
  hidden: string[];
  blocked: string[];
}

/** The member's own guestbook choices on this forum, read live from their declaration. */
export async function getGuestbookSettings(did: string, forum: string): Promise<GuestbookSettings> {
  const value = (await findDeclaration(did, forum))?.value ?? {};
  return { open: value.guestbook === true, hidden: strings(value.guestbookHidden), blocked: strings(value.guestbookBlocked) };
}

/** Sign `subject`'s guestbook on this forum: a record in the signer's own repo. */
export async function signGuestbook(did: string, forum: string, subject: string, text: string): Promise<{ uri: string; cid: string }> {
  const agent = await agentFor(did);
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: GUESTBOOK,
    record: { $type: GUESTBOOK, forum, subject, text, createdAt: new Date().toISOString() },
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

/**
 * When the signer last signed `subject`'s guestbook on this forum, from their
 * own repo (newest records first), or null. One page is plenty to cover a day.
 */
export async function lastGuestbookEntryAt(did: string, forum: string, subject: string): Promise<string | null> {
  const agent = await agentFor(did);
  const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: GUESTBOOK, limit: 100 });
  let newest: string | null = null;
  for (const record of res.data.records) {
    const value = record.value as { forum?: unknown; subject?: unknown; createdAt?: unknown };
    if (value.forum !== forum || value.subject !== subject || typeof value.createdAt !== 'string') continue;
    if (!newest || value.createdAt > newest) newest = value.createdAt;
  }
  return newest;
}

/** Take back a guestbook entry. Only its signer can: the check is on the URI's authority. */
export async function deleteGuestbookEntry(did: string, uri: string): Promise<void> {
  const p = parseAtUri(uri);
  if (!p || p.did !== did || p.collection !== GUESTBOOK) throw new Error('not your guestbook entry');
  const agent = await agentFor(did);
  await agent.com.atproto.repo.deleteRecord({ repo: did, collection: p.collection, rkey: p.rkey });
}

/** An access request targets a members-only board or, as an application, the forum itself. */
type AccessTarget = { board: string } | { forum: string };

/** The requester's own access-request record for a target, or null. */
async function findAccessRequest(did: string, target: AccessTarget): Promise<{ uri: string } | null> {
  try {
    const agent = await agentFor(did);
    const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: ACCESS_REQUEST, limit: 100 });
    const rec = res.data.records.find((r) => {
      const v = r.value as { board?: string; forum?: string };
      return 'board' in target ? v.board === target.board : v.forum === target.forum;
    });
    return rec ? { uri: rec.uri } : null;
  } catch {
    return null;
  }
}

/**
 * Write an access request into the member's repo. Asking again replaces the
 * earlier request so its timestamp is fresh: the queue only shows a request
 * newer than the last decision on it, so a resubmission reopens it.
 */
async function replaceAccessRequest(did: string, target: AccessTarget, reason?: string): Promise<void> {
  const agent = await agentFor(did);
  const existing = await findAccessRequest(did, target);
  if (existing) {
    const p = parseAtUri(existing.uri);
    if (p) await agent.com.atproto.repo.deleteRecord({ repo: did, collection: p.collection, rkey: p.rkey });
  }
  await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: ACCESS_REQUEST,
    record: {
      $type: ACCESS_REQUEST,
      ...target,
      ...(reason ? { reason } : {}),
      createdAt: new Date().toISOString(),
    },
  });
}

/** The requester's own pending access-request record for a board, or null. */
export const getAccessRequest = (did: string, board: string) => findAccessRequest(did, { board });

export const requestAccess = (did: string, board: string, reason?: string) =>
  replaceAccessRequest(did, { board }, reason);

/** The applicant's own application to join a gated forum, or null. */
export const getForumApplication = (did: string, forum: string) => findAccessRequest(did, { forum });

export const applyToForum = (did: string, forum: string, reason: string) =>
  replaceAccessRequest(did, { forum }, reason);

export async function leaveForum(did: string, membershipUri: string): Promise<void> {
  const p = parseAtUri(membershipUri);
  if (!p || p.did !== did || p.collection !== MEMBERSHIP) throw new Error('not your membership record');
  const agent = await agentFor(did);
  await agent.com.atproto.repo.deleteRecord({ repo: did, collection: p.collection, rkey: p.rkey });
  membershipCache.delete(did);
}

// Board watches mirror membership: read from the member's own PDS, cached
// briefly for display, and read live again before any write.
const watchCache = new Map<string, { value: Watch[]; at: number }>();

async function listWatches(did: string, forumDid: string): Promise<Watch[]> {
  const agent = await agentFor(did);
  const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: WATCH, limit: 100 });
  return watchesForForum(res.data.records, forumDid);
}

async function cachedWatches(did: string, forumDid: string): Promise<Watch[] | null> {
  return cached(watchCache, did, () => listWatches(did, forumDid));
}

/** The boards on this forum the member watches, or [] when the PDS can't be read. */
export async function getWatches(did: string, forumDid: string): Promise<Watch[]> {
  return (await cachedWatches(did, forumDid)) ?? [];
}

/** Whether the member watches the board, or null when the PDS can't be read. */
export async function isWatching(did: string, forumDid: string, boardUri: string): Promise<boolean | null> {
  const watches = await cachedWatches(did, forumDid);
  return watches && watches.some((w) => w.board === boardUri);
}

export async function watchBoard(did: string, forumDid: string, boardUri: string): Promise<void> {
  const agent = await agentFor(did);
  if (planWatch(await listWatches(did, forumDid), boardUri).create) {
    await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: WATCH,
      record: { $type: WATCH, board: boardUri, createdAt: new Date().toISOString() },
    });
  }
  watchCache.delete(did);
}

export async function unwatchBoard(did: string, forumDid: string, boardUri: string): Promise<void> {
  const agent = await agentFor(did);
  for (const uri of planUnwatch(await listWatches(did, forumDid), boardUri)) {
    const p = parseAtUri(uri);
    if (p) await agent.com.atproto.repo.deleteRecord({ repo: did, collection: p.collection, rkey: p.rkey });
  }
  watchCache.delete(did);
}

/**
 * A watch write the PDS refused. A scope or permission refusal means the
 * forum's permission set hasn't reached this account yet, so say so instead
 * of a generic failure; opt-in shows the same line.
 */
export function watchFailureMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message.toLowerCase() : '';
  const status = (e as { status?: number } | null)?.status;
  if (status === 403 || msg.includes('scope') || msg.includes('permission')) {
    return "The forum's permissions are still propagating on your account. Try again in a bit.";
  }
  return "Couldn't save that. Try again.";
}

/**
 * Images can't go in a space post yet. The composer uploads them as blobs on
 * the author's PDS, where a blob is only served (and only kept) while a record
 * in that repo references it. A space record isn't in the repo, so the image
 * would either be public or gone. Refuse instead of writing a broken post.
 */
export function assertNoImages(body: RichTextBlock[]): void {
  if (body.some((b) => b.$type.endsWith('#image'))) {
    throw new Error("Images aren't available on members-only boards yet. Remove them and try again.");
  }
}

export async function createThread(
  did: string,
  input: { board: string; title: string; body: RichTextBlock[]; tags?: string[]; poll?: Poll; via?: string },
): Promise<{ uri: string; cid: string }> {
  return withBoardWrite(input.board, () => writeThread(did, input));
}

async function writeThread(
  did: string,
  input: Parameters<typeof createThread>[1],
): Promise<{ uri: string; cid: string }> {
  const record = {
    $type: `${NS}.discussion.thread`,
    board: input.board,
    title: input.title,
    body: input.body,
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(input.poll ? { poll: input.poll } : {}),
    ...(input.via ? { via: input.via } : {}),
    createdAt: new Date().toISOString(),
  };
  // Members-only board: the thread lives in the board's permissioned space,
  // written as the member (Happyview enforces write membership), not in their
  // public repo. The board field still points at the public board record.
  const space = await getBoardAccess(input.board);
  if (space) {
    assertNoImages(input.body);
    // Votes are public records naming the thread; a space thread must not have a poll.
    if (input.poll) throw new Error("Polls aren't available on members-only boards.");
    const res = await createSpaceRecord(did, space, `${NS}.discussion.thread`, record);
    return { uri: res.uri, cid: res.cid };
  }
  const agent = await agentFor(did);
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: `${NS}.discussion.thread`,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

export async function createReply(
  did: string,
  input: { thread: { uri: string; cid: string }; parent?: { uri: string; cid: string }; body: RichTextBlock[] },
): Promise<{ uri: string; cid: string }> {
  const record = {
    $type: `${NS}.discussion.reply`,
    thread: input.thread,
    ...(input.parent ? { parent: input.parent } : {}),
    body: input.body,
    createdAt: new Date().toISOString(),
  };
  // A reply to a thread that lives in a space goes into the same space — the
  // thread's own URI tells us which one.
  const space = spaceUriOf(input.thread.uri);
  if (space) {
    assertNoImages(input.body);
    const res = await createSpaceRecord(did, space, `${NS}.discussion.reply`, record);
    return { uri: res.uri, cid: res.cid };
  }
  const agent = await agentFor(did);
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: `${NS}.discussion.reply`,
    record,
  });
  return { uri: res.data.uri, cid: res.data.cid };
}

// --- actor profile / avatar --------------------------------------------------

export interface ActorProfileRecord {
  $type?: string;
  displayName?: string;
  description?: string;
  avatar?: unknown; // BlobRef
  signature?: unknown[];
  title?: string;
  pronouns?: string;
  website?: string;
  createdAt?: string;
  theme?: string;
  forumThemes?: { forum?: string; theme?: string }[];
  [k: string]: unknown;
}

function plainActorProfile(profile: ActorProfileRecord): ActorProfileRecord {
  // The authenticated atproto client materializes blobs as BlobRef instances.
  // Profile records enter SvelteKit load data, which must contain plain values.
  return JSON.parse(JSON.stringify(profile)) as ActorProfileRecord;
}

export interface AvatarUpload {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

/** Editable profile fields, with an optional replacement image avatar. */
export interface ProfileEdit {
  displayName?: string;
  description?: string;
  notifications?: boolean;
  theme?: import('$lib/themes').ForumTheme | '';
  forumThemes?: { forum: string; theme: import('$lib/themes').ForumTheme | '' }[];
  signature?: unknown[];
  pronouns?: string;
  website?: string;
  /** Upload an override, omit to preserve it, or pass null to follow Bluesky again. */
  avatar?: AvatarUpload | null;
  profileSkin?: string;
  banner?: { pattern: string; swatch: string };
  headline?: string;
  currently?: string;
  about?: RichTextBlock[];
  panels?: { id: string; hidden?: boolean }[];
}

/**
 * Update the caller's actor.profile, preserving fields absent from the edit.
 * Uploading an image replaces the local avatar override; null removes it so
 * clients fall back to Bluesky. An empty string clears a text field.
 */
export async function saveProfile(did: string, edit: ProfileEdit, forum?: string, inherit: ProfileField[] = []): Promise<void> {
  const uploaded = edit.avatar
    ? await uploadProfileBlob(did, edit.avatar.bytes, edit.avatar.mimeType)
    : null;
  const fields: Record<string, unknown> = {};
  if ('displayName' in edit) fields.displayName = edit.displayName || undefined;
  if ('description' in edit) fields.description = edit.description || undefined;
  if ('signature' in edit) fields.signature = edit.signature?.length ? edit.signature : undefined;
  if ('pronouns' in edit) fields.pronouns = edit.pronouns || undefined;
  if ('website' in edit) fields.website = edit.website || undefined;
  if ('notifications' in edit) fields.notifications = edit.notifications;
  if ('theme' in edit) fields.theme = edit.theme || undefined;
  if ('forumThemes' in edit) fields.forumThemes = edit.forumThemes?.length ? edit.forumThemes : undefined;
  if ('profileSkin' in edit) fields.profileSkin = edit.profileSkin || undefined;
  if ('banner' in edit) fields.banner = edit.banner || undefined;
  if ('headline' in edit) fields.headline = edit.headline || undefined;
  if ('currently' in edit) fields.currently = edit.currently || undefined;
  if ('about' in edit) fields.about = edit.about?.length ? edit.about : undefined;
  if ('panels' in edit) fields.panels = edit.panels?.length ? edit.panels : undefined;
  if (uploaded) fields.avatar = uploaded;
  await patchActorProfile(
    did,
    fields,
    edit.avatar === null ? ['avatar'] : [],
    forum,
    inherit,
  );
}

// Short cache so the layout (every page) doesn't re-read the profile each nav.
const avatarCache = new Map<string, { profile: ActorProfileRecord; at: number }>();

/** The caller's own profile, briefly cached for avatar providers in the layout. */
export async function getOwnAvatarProfile(did: string): Promise<ActorProfileRecord> {
  const hit = avatarCache.get(did);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.profile;
  const value = (await getActorProfile(did)) ?? {};
  avatarCache.set(did, { profile: value, at: Date.now() });
  return value;
}

/** Read the caller's own actor.profile record (self), or null if none yet. */
export async function getActorProfile(did: string): Promise<ActorProfileRecord | null> {
  try {
    const agent = await agentFor(did);
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: ACTOR_PROFILE,
      rkey: 'self',
    });
    return plainActorProfile(res.data.value as ActorProfileRecord);
  } catch {
    return null;
  }
}

/** Upload a blob to the signed-in account's repo for use by the profile. */
export async function uploadProfileBlob(did: string, bytes: Uint8Array, mimeType: string): Promise<unknown> {
  const agent = await agentFor(did);
  const uploaded = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: mimeType });
  return uploaded.data.blob;
}

/** Preserve the actor profile, including fields written by other apps, while applying edits. */
export async function patchActorProfile(
  did: string,
  fields: Record<string, unknown>,
  remove: string[] = [],
  forum?: string,
  inherit: ProfileField[] = [],
): Promise<void> {
  const agent = await agentFor(did);
  let existing: ActorProfileRecord = {};
  let swapRecord: string | null = null;
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo: did, collection: ACTOR_PROFILE, rkey: 'self' });
    existing = plainActorProfile(res.data.value as ActorProfileRecord);
    swapRecord = res.data.cid ?? null;
  } catch (error) {
    if ((error as { error?: string }).error !== 'RecordNotFound') throw error;
  }
  if (forum) {
    const previous = forumProfileOverride(existing, forum);
    const override: ForumProfileOverride = { ...previous, forum, fields: [...(previous?.fields ?? [])] };
    for (const key of PROFILE_FIELDS) {
      if (key in fields || remove.includes(key)) {
        if (!override.fields.includes(key)) override.fields.push(key);
        if (fields[key] === undefined || remove.includes(key)) delete override[key];
        else override[key] = fields[key];
      }
      if (inherit.includes(key)) {
        override.fields = override.fields.filter((field) => field !== key);
        delete override[key];
      }
    }
    const forumProfiles = (Array.isArray(existing.forumProfiles) ? existing.forumProfiles : [])
      .filter((entry) => entry.forum !== forum);
    if (override.fields.length) forumProfiles.push(override);
    fields = { forumProfiles: forumProfiles.length ? forumProfiles : undefined };
    remove = [];
  }
  const record: ActorProfileRecord = {
    ...existing,
    ...fields,
  };
  for (const key of remove) delete record[key];
  record.$type = ACTOR_PROFILE;
  record.createdAt = existing.createdAt ?? new Date().toISOString();
  for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: ACTOR_PROFILE,
    rkey: 'self',
    // A concurrent edit on another forum must fail, not silently lose its choices.
    swapRecord,
    record,
  });
  avatarCache.set(did, {
    profile: plainActorProfile(record),
    at: Date.now(),
  });
  bustProfileCache(did);
}

// --- Editing and deleting your own posts -----------------------------------
// A post is a record in its author's repo (or, on a members-only board, in
// the board's space), so only its author can change it, and the check is on
// the URI's authority rather than anything the form sends.

interface PostRef {
  did: string;
  collection: string;
  rkey: string;
  space: string | null;
}

/** Where a thread or reply URI lives, or null when it isn't one of ours. */
function postRef(uri: string): PostRef | null {
  const space = spaceUriOf(uri);
  if (space) {
    // at://<forum>/space/<type>/<skey>/<author>/<collection>/<rkey>
    const parts = uri.split('/');
    if (parts.length !== 9) return null;
    return { did: parts[6], collection: parts[7], rkey: parts[8], space };
  }
  const p = parseAtUri(uri);
  return p ? { ...p, space: null } : null;
}

const POST_COLLECTIONS = new Set([`${NS}.discussion.thread`, `${NS}.discussion.reply`]);

function ownPost(did: string, uri: string): PostRef {
  const ref = postRef(uri);
  if (!ref || ref.did !== did || !POST_COLLECTIONS.has(ref.collection)) {
    throw new Error('not one of your posts');
  }
  return ref;
}

/** The record as stored, from the PDS or the space, ready to be re-put. */
async function currentPost(did: string, ref: PostRef): Promise<Record<string, unknown>> {
  if (ref.space) {
    const res = await getSpaceRecord<Record<string, unknown>>(did, ref.space, did, ref.collection, ref.rkey);
    return res.value;
  }
  const agent = await agentFor(did);
  const res = await agent.com.atproto.repo.getRecord({ repo: did, collection: ref.collection, rkey: ref.rkey });
  return res.data.value as Record<string, unknown>;
}

/**
 * Replace a post's body (and a thread's title), stamping editedAt. Everything
 * else on the record, the board, the thread ref, the poll, rides through
 * untouched. Returns the editedAt written, so callers can wait for the index.
 */
export async function updatePost(
  did: string,
  uri: string,
  patch: { title?: string; body: RichTextBlock[]; tags?: string[] },
): Promise<{ editedAt: string }> {
  const ref = ownPost(did, uri);
  if (ref.space) assertNoImages(patch.body);
  const editedAt = new Date().toISOString();
  const current = await currentPost(did, ref);
  const record = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    body: patch.body,
    editedAt,
  };
  if (ref.space) {
    await putSpaceRecord(did, ref.space, ref.collection, ref.rkey, record);
  } else {
    const agent = await agentFor(did);
    await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: ref.collection,
      rkey: ref.rkey,
      record: jsonToLex(record) as Record<string, unknown>,
    });
  }
  return { editedAt };
}

/** Remove a post from its author's repo or space. Replies to a deleted
 *  thread stay in their own authors' repos, unlisted. */
export async function deletePost(did: string, uri: string): Promise<void> {
  const ref = ownPost(did, uri);
  if (ref.space) {
    await deleteSpaceRecord(did, ref.space, ref.collection, ref.rkey);
    return;
  }
  const agent = await agentFor(did);
  await agent.com.atproto.repo.deleteRecord({ repo: did, collection: ref.collection, rkey: ref.rkey });
}

// --- Profile pins -------------------------------------------------------------
// The topics a member pins to their profile page on this forum, kept on their
// membership record next to `wearing` because pins belong to one forum.

/** Pin up to MAX_PINS of the member's own topics on this forum, in order. An empty list unpins them all. */
export async function setPinned(did: string, forum: string, pinned: string[]): Promise<void> {
  if (pinned.length > MAX_PINS) throw new Error(`You can pin up to ${MAX_PINS} topics.`);
  if (new Set(pinned).size !== pinned.length) throw new Error('That topic is already pinned.');
  await Promise.all(pinned.map((uri) => assertOwnTopicOn(did, forum, uri)));
  await patchMembership(did, forum, { pinned: pinned.length ? pinned : undefined });
  bustProfileCache(did);
}

/**
 * Authorship is checked on the URI like ownPost: the authority of a public
 * thread, the author segment of a space thread (whose authority is the forum).
 * The forum is checked on the stored thread's board, which lives in the
 * forum's repo.
 */
async function assertOwnTopicOn(did: string, forum: string, uri: string): Promise<void> {
  const ref = postRef(uri);
  if (!ref || ref.did !== did || ref.collection !== `${NS}.discussion.thread`) {
    throw new Error('You can only pin your own topics.');
  }
  if (ref.space && !ref.space.startsWith(`at://${forum}/`)) throw new Error('You can only pin topics on this forum.');
  const thread = await currentPost(did, ref);
  if (typeof thread.board !== 'string' || parseAtUri(thread.board)?.did !== forum) {
    throw new Error('You can only pin topics on this forum.');
  }
}

// --- Poll votes -------------------------------------------------------------
// One app.atmobb.poll.vote record per chosen option, in the voter's repo.
// Retracting deletes the record; changing a single-choice vote is a delete
// then a create. The tally lives in the appview.

const VOTE = `${NS}.poll.vote`;

export async function castVote(
  did: string,
  thread: { uri: string; cid: string },
  option: number,
): Promise<{ uri: string }> {
  const agent = await agentFor(did);
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: VOTE,
    record: {
      $type: VOTE,
      subject: { $type: 'com.atproto.repo.strongRef', uri: thread.uri, cid: thread.cid },
      option,
      createdAt: new Date().toISOString(),
    },
  });
  return { uri: res.data.uri };
}

export async function retractVote(did: string, uri: string): Promise<void> {
  const p = parseAtUri(uri);
  if (!p || p.did !== did || p.collection !== VOTE) throw new Error('not your vote');
  const agent = await agentFor(did);
  await agent.com.atproto.repo.deleteRecord({ repo: did, collection: p.collection, rkey: p.rkey });
}
