// Where a member may be sent back after login or after dismissing the
// notifications prompt. A fixed allowlist of this app's own route shapes, so
// a crafted `next` can never bounce someone off the forum.
const SETTINGS = /^\/settings\/notifications(\?reconsented=1)?$/;
const PUBLIC_THREAD = /^\/t\/did:[a-z0-9:.-]+\/[A-Za-z0-9._~-]+$/;
const SPACE_THREAD = /^\/b\/(did:[a-z0-9:.-]+\/)?[A-Za-z0-9._~-]+\/t\/did:[a-z0-9:.-]+\/[A-Za-z0-9._~-]+$/;
const NOTIFICATIONS = /^\/notifications$/;
// Entry ids are UUIDs (store.ts); the only query an open link carries is the
// members-only alert marker.
const NOTIFICATION_OPEN = /^\/notifications\/open\/[0-9a-f-]{36}(\?via=notify)?$/;

export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (
    SETTINGS.test(raw) ||
    PUBLIC_THREAD.test(raw) ||
    SPACE_THREAD.test(raw) ||
    NOTIFICATIONS.test(raw) ||
    NOTIFICATION_OPEN.test(raw)
  )
    return raw;
  return null;
}
