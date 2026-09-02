const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relTime(iso?: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = Date.now() - t;
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 14 * DAY) return `${Math.floor(d / DAY)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
