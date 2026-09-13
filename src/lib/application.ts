/** A forum application: an accessRequest record with `forum` set. */
export interface ApplicationRecord {
  uri: string;
  cid?: string;
  did: string;
  createdAt: string;
  reason?: string;
}

/** A moderation action about the applicant, as the appview reports it. */
export interface Decision {
  action: string;
  createdAt: string;
  /** Present on board-scoped decisions, which never answer a forum application. */
  board?: string;
}

export type ApplicationState = 'pending' | 'waiting' | 'denied' | 'accepted';

const ANSWERS: Record<string, ApplicationState> = {
  acceptMember: 'accepted',
  holdApplication: 'waiting',
  denyAccess: 'denied',
};

/**
 * The newest forum-level decision made since the application was written
 * decides its state. A resubmitted application is newer than the old
 * denial, so it reopens as pending.
 */
export function applicationState(app: ApplicationRecord, decisions: Decision[]): ApplicationState {
  const since = new Date(app.createdAt).getTime();
  let newest: Decision | undefined;
  for (const d of decisions) {
    if (d.board || !(d.action in ANSWERS)) continue;
    if (new Date(d.createdAt).getTime() < since) continue;
    if (!newest || new Date(d.createdAt).getTime() > new Date(newest.createdAt).getTime()) newest = d;
  }
  return newest ? ANSWERS[newest.action] : 'pending';
}

/** The parts of a thread summary the founding set reads. */
export interface PosterSource {
  board: string;
  author: string;
  lastReplyBy?: string;
  participants?: { did: string }[];
}

/** DIDs seen posting in a forum's public threads. The feed carries each
 *  thread's author, last replier, and up to five participants, so a long
 *  thread's quieter repliers can be missed; the roster covers anyone who
 *  also declared membership. Merged-topic threads from other forums are
 *  skipped. */
export function posterDids(threads: PosterSource[], forumDid: string): string[] {
  const out: string[] = [];
  for (const t of threads) {
    if (!t.board.startsWith(`at://${forumDid}/`)) continue;
    out.push(t.author);
    if (t.lastReplyBy) out.push(t.lastReplyBy);
    for (const p of t.participants ?? []) out.push(p.did);
  }
  return out;
}

/** Everyone who was already here when an open forum gates: each declarer,
 *  poster, and staffer once, never the forum's own account. */
export function grandfatherSet(
  present: { declarers: string[]; posters: string[]; staff: string[] },
  forumDid: string,
): string[] {
  const seen = new Set<string>([forumDid]);
  const out: string[] = [];
  for (const did of [...present.declarers, ...present.posters, ...present.staff]) {
    if (seen.has(did)) continue;
    seen.add(did);
    out.push(did);
  }
  return out;
}
