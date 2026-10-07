import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { MEMBER_SCOPE, oauthClient } from '$lib/server/atproto-oauth';
import { OAuthConfigurationError } from '$lib/server/happyview-oauth';
import { clearSessionCookie } from '$lib/server/session';
import { safeReturnPath } from '$lib/server/notify/return-path';

export const actions: Actions = {
  login: async ({ request, cookies }) => {
    const form = await request.formData();
    const handle = String(form.get('handle') ?? '').trim().replace(/^@/, '');
    if (!handle) return fail(400, { message: 'Enter your handle.', handle });
    // Where to land after the callback; only the app's own allowlisted paths.
    const next = safeReturnPath(form.get('next'));
    let authorizeUrl: URL;
    try {
      authorizeUrl = await oauthClient().authorize(handle, {
        scope: MEMBER_SCOPE,
        cookies,
        context: { purpose: 'member', ...(next ? { next } : {}) },
      });
    } catch (e) {
      return fail(502, { message: e instanceof OAuthConfigurationError ? e.message : 'Login failed. Check your handle and try again.', handle });
    }
    redirect(303, authorizeUrl.toString());
  },
  logout: async ({ cookies }) => {
    clearSessionCookie(cookies);
    redirect(303, '/');
  },
};
