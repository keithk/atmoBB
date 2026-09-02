import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { MEMBER_SCOPE, oauthClient } from '$lib/server/atproto-oauth';
import { clearSessionCookie } from '$lib/server/session';

export const actions: Actions = {
  login: async ({ request }) => {
    const form = await request.formData();
    const handle = String(form.get('handle') ?? '').trim().replace(/^@/, '');
    if (!handle) return fail(400, { message: 'Enter your handle.' });
    let authorizeUrl: URL;
    try {
      authorizeUrl = await oauthClient().authorize(handle, { scope: MEMBER_SCOPE });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'Login failed. Try again.', handle });
    }
    redirect(303, authorizeUrl.toString());
  },
  logout: async ({ cookies }) => {
    clearSessionCookie(cookies);
    redirect(303, '/');
  },
};
