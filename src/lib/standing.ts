/** A ban in force against a member, as the appview reports it. */
export interface Ban {
  uri: string;
  /** Board the ban is limited to; absent means the whole forum. */
  board?: string;
  since: string;
  until?: string;
  reason?: string;
}

/** The ban that keeps a member off `board` (or off the forum when no board
 *  is given), if any. Forum-wide bans cover every board. */
export function banCovering(bans: Ban[], board?: string, now = new Date()): Ban | undefined {
  return bans.find(
    (b) => (!b.until || new Date(b.until) > now) && (!b.board || (board !== undefined && b.board === board)),
  );
}

/** A duration in days from the ban form, as an expiry timestamp. */
export function expiryFromDays(days: string, now = new Date()): string | undefined {
  const n = days.trim() ? Number(days) : 0;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(now.getTime() + n * 86_400_000).toISOString();
}
