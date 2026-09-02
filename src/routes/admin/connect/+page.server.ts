import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { oauthClient, SYSOP_SCOPE } from '$lib/server/atproto-oauth';
import { FORUM_DID, resolveHandle } from '$lib/server/appview';

export const load: PageServerLoad = async ({ url }) => {
  return {
    forumHandle: await resolveHandle(FORUM_DID()),
    error: url.searchParams.get('error'),
  };
};

export const actions: Actions = {
  connect: async ({ request, locals }) => {
    if (!locals.user) redirect(303, '/login');
    const form = await request.formData();
    const handle = String(form.get('handle') ?? '').trim().replace(/^@/, '');
    if (!handle) return fail(400, { message: "Enter the forum account's handle." });
    let authorizeUrl: URL;
    try {
      authorizeUrl = await oauthClient().authorize(handle, {
        scope: SYSOP_SCOPE,
        state: `forum-connect:${locals.user.did}`,
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t connect the forum account. Try again.', handle });
    }
    redirect(303, authorizeUrl.toString());
  },
};
