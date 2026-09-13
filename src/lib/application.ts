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

/** Everyone who was already here when an open forum gates: each declarer
 *  and each poster once, never the forum's own account. */
export function grandfatherSet(declarers: string[], posters: string[], forumDid: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const did of [...declarers, ...posters]) {
    if (did === forumDid || seen.has(did)) continue;
    seen.add(did);
    out.push(did);
  }
  return out;
}
