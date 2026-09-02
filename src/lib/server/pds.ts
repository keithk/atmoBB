import { jsonToLex } from '@atproto/api';
import { agentFor } from './atproto-oauth';
import { parseAtUri } from '$lib/appview-paths';
import type { Poll, RichTextBlock } from './appview';
import {
  createSpaceRecord,
  deleteSpaceRecord,
  getBoardAccess,
  getSpaceRecord,
  putSpaceRecord,
  spaceUriOf,
} from './appview';

const NS = 'app.atmobb';
const MEMBERSHIP = `${NS}.forum.membership`;
const ACTOR_PROFILE = `${NS}.actor.profile`;
const ACCESS_REQUEST = `${NS}.forum.accessRequest`;

// Membership is read from the member's own PDS (authoritative, no index lag)
// and cached briefly so the layout doesn't hit the PDS on every page load.
const membershipCache = new Map<string, { value: Membership; at: number }>();

export interface Membership {
  joined: boolean;
  uri?: string;
}

export async function getMembership(did: string, forum: string): Promise<Membership | null> {
  const hit = membershipCache.get(did);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.value;
  try {
    const agent = await agentFor(did);
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: MEMBERSHIP,
      limit: 100,
    });
    const rec = res.data.records.find((r) => (r.value as { forum?: string }).forum === forum);
    const value = { joined: !!rec, uri: rec?.uri };
    membershipCache.set(did, { value, at: Date.now() });
    return value;
  } catch {
    // PDS unreachable or session dead — pages render without the join state
    return null;
  }
}

export async function joinForum(did: string, forum: string): Promise<void> {
  const agent = await agentFor(did);
  await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: MEMBERSHIP,
    record: { $type: MEMBERSHIP, forum, createdAt: new Date().toISOString() },
  });
  membershipCache.delete(did);
}

/** The requester's own pending access-request record for a board, or null. */
export async function getAccessRequest(did: string, board: string): Promise<{ uri: string } | null> {
  try {
    const agent = await agentFor(did);
    const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: ACCESS_REQUEST, limit: 100 });
    const rec = res.data.records.find((r) => (r.value as { board?: string }).board === board);
    return rec ? { uri: rec.uri } : null;
  } catch {
    return null;
  }
}

/**
 * Write an access-request record into the member's repo. Asking again replaces
 * the earlier request so its timestamp is fresh: the moderation queue only
 * shows a request newer than the last decision on it.
 */
export async function requestAccess(did: string, board: string, reason?: string): Promise<void> {
  const agent = await agentFor(did);
  const existing = await getAccessRequest(did, board);
  if (existing) {
    const p = parseAtUri(existing.uri);
    if (p) await agent.com.atproto.repo.deleteRecord({ repo: did, collection: p.collection, rkey: p.rkey });
  }
  await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: ACCESS_REQUEST,
    record: {
      $type: ACCESS_REQUEST,
      board,
      ...(reason ? { reason } : {}),
      createdAt: new Date().toISOString(),
    },
  });
}

export async function leaveForum(did: string, membershipUri: string): Promise<void> {
  const p = parseAtUri(membershipUri);
  if (!p || p.did !== did || p.collection !== MEMBERSHIP) throw new Error('not your membership record');
  const agent = await agentFor(did);
  await agent.com.atproto.repo.deleteRecord({ repo: did, collection: p.collection, rkey: p.rkey });
  membershipCache.delete(did);
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
  input: { board: string; title: string; body: RichTextBlock[]; poll?: Poll; via?: string },
): Promise<{ uri: string; cid: string }> {
  const record = {
    $type: `${NS}.discussion.thread`,
    board: input.board,
    title: input.title,
    body: input.body,
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
  signature?: unknown[];
  pronouns?: string;
  website?: string;
  avatar?: AvatarUpload;
}

/**
 * Update the caller's actor.profile, preserving fields absent from the edit.
 * Uploading an image replaces a builder recipe so the portable blob becomes
 * the source of truth. An empty string clears a text field.
 */
export async function saveProfile(did: string, edit: ProfileEdit): Promise<void> {
  const uploaded = edit.avatar
    ? await uploadProfileBlob(did, edit.avatar.bytes, edit.avatar.mimeType)
    : null;
  await patchActorProfile(
    did,
    {
      displayName: edit.displayName || undefined,
      description: edit.description || undefined,
      signature: edit.signature && edit.signature.length ? edit.signature : undefined,
      pronouns: edit.pronouns || undefined,
      website: edit.website || undefined,
      ...(uploaded ? { avatar: uploaded } : {}),
    },
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
): Promise<void> {
  const agent = await agentFor(did);
  const existing = (await getActorProfile(did)) ?? {};
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
    record,
  });
  avatarCache.set(did, {
    profile: plainActorProfile(record),
    at: Date.now(),
  });
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
  patch: { title?: string; body: RichTextBlock[] },
): Promise<{ editedAt: string }> {
  const ref = ownPost(did, uri);
  if (ref.space) assertNoImages(patch.body);
  const editedAt = new Date().toISOString();
  const current = await currentPost(did, ref);
  const record = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
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
