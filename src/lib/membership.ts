/** How people join a forum. Absent on the profile means open. */
export type JoinMode = 'open' | 'apply' | 'invite';

/** A forum's acceptance of one member, as the appview reports it from
 *  acceptMember / revokeMember actions. Open while `until` is absent. */
export interface MembershipWindow {
  since: string;
  until?: string;
  /** Who brought them in; absent for founding members. */
  sponsor?: string;
  /** invite, application, or founding. */
  via?: string;
}

/** A stretch of time during which the forum enforced membership. Open-ended
 *  while `openedAt` is absent. */
export interface GatingPeriod {
  gatedSince: string;
  openedAt?: string;
  mode?: string;
}

/**
 * A viewer's standing on this forum.
 *
 * - `open`: the forum has no gate; the existing declaration-based rules apply.
 * - `exempt`: the forum's own account, never gated.
 * - `member`: accepted and declared.
 * - `accepted-undeclared`: the forum accepted them but their own membership
 *   record is missing (approved applicant on first visit, or someone who left).
 * - `nonmember`: no open acceptance, or signed out.
 */
export type Standing = 'open' | 'exempt' | 'member' | 'accepted-undeclared' | 'nonmember';

export function joinMode(membership: { mode?: string } | undefined): JoinMode {
  const m = membership?.mode;
  return m === 'apply' || m === 'invite' ? m : 'open';
}

export function isGated(mode: JoinMode): boolean {
  return mode !== 'open';
}

/** Whether a window was open at `at`: since ≤ at < until. */
export function windowCovers(window: MembershipWindow | undefined, at: Date): boolean {
  if (!window) return false;
  const t = at.getTime();
  return new Date(window.since).getTime() <= t && (!window.until || t < new Date(window.until).getTime());
}

/** Whether the forum was enforcing membership at `at`. */
export function gatedAt(periods: GatingPeriod[], at: Date): boolean {
  const t = at.getTime();
  return periods.some(
    (p) => new Date(p.gatedSince).getTime() <= t && (!p.openedAt || t < new Date(p.openedAt).getTime()),
  );
}

export function standingFor(input: {
  mode: JoinMode;
  forumDid: string;
  viewer?: string;
  window?: MembershipWindow;
  declared: boolean;
  now?: Date;
}): Standing {
  if (!isGated(input.mode)) return 'open';
  if (!input.viewer) return 'nonmember';
  if (input.viewer === input.forumDid) return 'exempt';
  if (!windowCovers(input.window, input.now ?? new Date())) return 'nonmember';
  return input.declared ? 'member' : 'accepted-undeclared';
}

export function canPost(standing: Standing): boolean {
  return standing === 'open' || standing === 'member' || standing === 'exempt';
}

/** The line under a member's name on a gated forum. `name` resolves a DID
 *  to a display handle, or nothing when the account no longer resolves. */
export function sponsorLine(window: MembershipWindow, name: (did: string) => string | undefined): string {
  if (window.via === 'founding' || !window.sponsor) return 'original member';
  const who = name(window.sponsor) ?? 'a former member';
  return `${window.via === 'application' ? 'approved' : 'invited'} by ${who}`;
}

/** A resolved handle from a DID-to-handle map, or nothing when resolution
 *  fell back to the DID itself. */
export function resolvedHandle(handles: Record<string, string | null | undefined>, did: string): string | undefined {
  const h = handles[did];
  return h && h !== did ? h : undefined;
}

/** The sponsor line plus the sponsor's handle for linking, from a handle map. */
export function sponsorDisplay(
  window: MembershipWindow,
  handles: Record<string, string | null | undefined>,
): { text: string; handle: string | null } {
  const name = (did: string) => {
    const h = resolvedHandle(handles, did);
    return h ? `@${h}` : undefined;
  };
  const handle = window.sponsor ? (resolvedHandle(handles, window.sponsor) ?? null) : null;
  return { text: sponsorLine(window, name), handle };
}
