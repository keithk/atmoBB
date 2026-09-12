import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { markRead, readMember } from '$lib/server/notify/store';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, '/login');
  const member = await readMember(locals.user.did);
  // KTD14 re-check runs here in a later unit: while `pending`, re-request the
  // permission (at most once a minute) and flip to `on` on alreadyGranted.
  return {
    status: member?.status ?? 'off',
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
