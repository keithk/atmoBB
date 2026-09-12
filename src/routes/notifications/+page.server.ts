import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { agentFor } from '$lib/server/atproto-oauth';
import { canRetryTurnOn, forumPermissionDetails, optInDeps, recheckPending } from '$lib/server/notify/optin';
import { markRead, readMember } from '$lib/server/notify/store';

const DASHBOARD_URL = 'https://atmo.pub';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  if (!locals.user) redirect(302, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  // KTD14: while `pending`, ask the relay again (at most once a minute) and
  // flip to `on` on alreadyGranted, since the relay does not call back yet.
  const deps = optInDeps(agentFor);
  if (deps) {
    const { forum, forumFavicon } = (await parent()) as { forum: { name: string }; forumFavicon: { url: string } | null };
    await recheckPending({ did: locals.user.did, deps, ...forumPermissionDetails(forum.name, forumFavicon?.url) });
  }
  const member = await readMember(locals.user.did);
  return {
    status: member?.status ?? 'off',
    canSend: deps !== null,
    canRetry: canRetryTurnOn(member, Date.now()),
    dashboardUrl: DASHBOARD_URL,
    // The store keeps entries newest first.
    entries: (member?.entries ?? []).map(({ id, kind, title, body, url, at, read, delivery }) => ({
      id,
      kind,
      title,
      body,
      url,
      at,
      read,
      delivery,
    })),
  };
};

// Mark-read is the member's own action, so a write failure fails closed (KTD4).
export const actions: Actions = {
  read: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to manage your notifications.' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { message: 'That notification is missing.' });
    try {
      await markRead(locals.user.did, [id]);
    } catch {
      return fail(500, { message: "Couldn't save that. Try again in a moment." });
    }
  },
  readAll: async ({ locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to manage your notifications.' });
    try {
      await markRead(locals.user.did, 'all');
    } catch {
      return fail(500, { message: "Couldn't save that. Try again in a moment." });
    }
  },
};
