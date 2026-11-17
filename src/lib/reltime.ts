const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "5m ago", "3h ago", "4d ago"; then "Oct 10" this year and "Oct 2025" before it. */
export function relTime(iso?: string | null, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = now - t;
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 14 * DAY) return `${Math.floor(d / DAY)}d ago`;
  const date = new Date(t);
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
