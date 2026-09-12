import { redirect } from '@sveltejs/kit';
import { bumpStats } from './store';

// Click-through counting for notification links (KTD9). A link the forum
// sent out carries `via=notify`; the first document load of it by a member
// bumps the visited counter and bounces to the same URL without the marker,
// so reloads, back navigation, client data re-fetches, and unfurl bots (no
// session) never count. Lives in the thread routes, not the request hook.

export const NOTIFY_VIA = 'notify';

// Pure: where to send a counted visit, or null when this request must not count.
export function notifyVisitRedirect(
  url: URL,
  opts: { isDataRequest: boolean; hasSession: boolean },
): string | null {
  if (opts.isDataRequest || !opts.hasSession) return null;
  if (url.searchParams.get('via') !== NOTIFY_VIA) return null;
  const target = new URL(url);
  target.searchParams.delete('via');
  return target.pathname + target.search + target.hash;
}

interface VisitEvent {
  url: URL;
  isDataRequest: boolean;
  locals: App.Locals;
  setHeaders?: (headers: Record<string, string>) => void;
}

export function handleNotifyVisit({ url, isDataRequest, locals, setHeaders }: VisitEvent): void {
  const target = notifyVisitRedirect(url, { isDataRequest, hasSession: locals.user !== null });
  if (!target) return;
  // The metric is approximate by design: a failed bump never blocks the visit.
  bumpStats('visited').catch((err) => console.warn('[notify] visited bump failed:', err));
  // Neither the marked response nor its redirect may land in a shared cache.
  setHeaders?.({ 'cache-control': 'private, no-store' });
  redirect(303, target);
}
