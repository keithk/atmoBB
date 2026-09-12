import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markRead, readMember } from '$lib/server/notify/store';
import { NOTIFY_VIA } from '$lib/server/notify/visit';

// Opening an entry: mark it read and go to the post. The stored URL's
// click-through marker is dropped, because that metric counts returns from
// outside channels only (KTD9); a bell click has none. Members-only alerts
// point here from outside too, since the real permalink embeds a DID (KTD8),
// and those links carry their own marker, which passes through so the thread
// page still counts the return. The member's own session gates the redirect.
export const GET: RequestHandler = async ({ params, url, locals, setHeaders }) => {
  if (!locals.user) redirect(302, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  const member = await readMember(locals.user.did);
  const entry = member?.entries.find((e) => e.id === params.id);
  if (!entry) error(404, 'That notification is gone.');
  await markRead(locals.user.did, [entry.id]);
  const target = new URL(entry.url);
  target.searchParams.delete('via');
  if (url.searchParams.get('via') === NOTIFY_VIA) target.searchParams.set('via', NOTIFY_VIA);
  setHeaders({ 'cache-control': 'private, no-store' });
  redirect(303, target.href);
};
