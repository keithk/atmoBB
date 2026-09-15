// Where a member may be sent back after login or after dismissing the
// notifications prompt. A fixed allowlist of this app's own route shapes, so
// a crafted `next` can never bounce someone off the forum.
const SETTINGS = /^\/settings\/notifications(\?reconsented=1)?$/;
const SLUG = String.raw`(?:[A-Za-z0-9-]|%[0-9A-Fa-f]{2})+`;
const PUBLIC_THREAD = new RegExp(
  String.raw`^\/t\/(?:did:[a-z0-9:.-]+\/[A-Za-z0-9._~-]+|${SLUG}\/${SLUG}\/did:[a-z0-9:.-]+\/[A-Za-z0-9._~-]+)$`,
);
const SPACE_THREAD = /^\/b\/(did:[a-z0-9:.-]+\/)?[A-Za-z0-9._~-]+\/t\/did:[a-z0-9:.-]+\/[A-Za-z0-9._~-]+$/;
const NOTIFICATIONS = /^\/notifications$/;
// Entry ids are UUIDs (store.ts); the only query an open link carries is the
// members-only alert marker.
const NOTIFICATION_OPEN = /^\/notifications\/open\/[0-9a-f-]{36}(\?via=notify)?$/;
// Invite tokens are 26 base32 characters (invites.ts newToken); a signed-out
// visitor is sent through login and back to the same link.
const JOIN = /^\/join\/[a-z2-7]{26}$/;
// Where the "Finish joining" notice sends a member back to: the home page,
// Latest, a board (optionally paged), or the apply page.
const HOME = /^\/(latest|apply)?$/;
const BOARD = /^\/b\/(did:[a-z0-9:.-]+\/)?[A-Za-z0-9._~-]+(\?page=\d{1,4})?$/;

export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (
    SETTINGS.test(raw) ||
    PUBLIC_THREAD.test(raw) ||
    SPACE_THREAD.test(raw) ||
    NOTIFICATIONS.test(raw) ||
    NOTIFICATION_OPEN.test(raw) ||
    JOIN.test(raw) ||
    HOME.test(raw) ||
    BOARD.test(raw)
  )
    return raw;
  return null;
}
