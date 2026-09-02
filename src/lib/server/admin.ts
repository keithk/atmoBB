import { getStaff, FORUM_DID, type Staff } from './appview';
import { oauthClient } from './atproto-oauth';
import { grantCovers } from '$lib/staff';

const TTL = 60 * 1000;

let staffCache: { staff: Staff['staff']; at: number } | null = null;

export async function forumStaff(): Promise<Staff['staff']> {
  if (staffCache && Date.now() - staffCache.at < TTL) return staffCache.staff;
  try {
    const res = await getStaff(FORUM_DID());
    staffCache = { staff: res.staff, at: Date.now() };
    return res.staff;
  } catch {
    // appview down — serve stale staff over locking admins out entirely
    return staffCache?.staff ?? [];
  }
}

export function invalidateStaff() {
  staffCache = null;
}

/** True while no staff grants exist: the forum is waiting for first setup. */
export async function forumUnclaimed(): Promise<boolean> {
  return (await forumStaff()).length === 0;
}

export async function isAdmin(did: string | null | undefined): Promise<boolean> {
  if (!did) return false;
  const staff = await forumStaff();
  return staff.some((s) => s.subject === did && s.role === 'admin');
}

/** For form actions: the acting admin's DID, or null when not authorized. */
export async function adminActor(locals: App.Locals): Promise<string | null> {
  const did = locals.user?.did;
  if (!did) return null;
  return (await isAdmin(did)) ? did : null;
}

export async function staffRole(did: string | null | undefined): Promise<string | null> {
  if (!did) return null;
  const staff = await forumStaff();
  return staff.find((s) => s.subject === did)?.role ?? null;
}

/** Whether `did` may moderate `board`: admins and unscoped moderators
 *  everywhere, scoped moderators only on the boards their grant names. */
export async function canModerate(did: string | null | undefined, board: string): Promise<boolean> {
  if (!did) return false;
  const grant = (await forumStaff()).find((s) => s.subject === did);
  return !!grant && grantCovers(grant, board);
}

/** Whether `did` may act forum-wide: admins and unscoped moderators. */
export async function canModerateForum(did: string | null | undefined): Promise<boolean> {
  if (!did) return false;
  const grant = (await forumStaff()).find((s) => s.subject === did);
  return !!grant && (grant.role === 'admin' || !grant.boards?.length);
}

/** For mod actions on a board: the acting staff member's DID, or null. */
export async function boardModerator(locals: App.Locals, board: string): Promise<string | null> {
  const did = locals.user?.did;
  if (!did) return null;
  return (await canModerate(did, board)) ? did : null;
}

let sessionCache: { connected: boolean; at: number } | null = null;

/** Whether the forum account has a working OAuth session in the store. */
export async function forumConnected(): Promise<boolean> {
  if (sessionCache && Date.now() - sessionCache.at < TTL) return sessionCache.connected;
  let connected = false;
  try {
    await oauthClient().restore(FORUM_DID());
    connected = true;
  } catch {
    // no session (or refresh failed) — the connect screen handles it
  }
  sessionCache = { connected, at: Date.now() };
  return connected;
}

export function invalidateForumSession() {
  sessionCache = null;
}

/** Resolve a handle to a DID via the public appview (for the staff form). */
export async function resolveDid(handle: string): Promise<string | null> {
  const clean = handle.trim().replace(/^@/, '');
  if (clean.startsWith('did:')) return clean;
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { did?: string };
    return data.did ?? null;
  } catch {
    return null;
  }
}
