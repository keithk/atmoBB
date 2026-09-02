import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  hostingEnabled,
  hostingDomainSuffix,
  requestsFor,
  submitRequest,
  SUBDOMAIN_RULE,
} from '$lib/server/hosting';
import { resolveActor } from '$lib/server/profiles';

export const load: PageServerLoad = async ({ locals }) => {
  if (!hostingEnabled()) error(404, 'Not found');
  const mine = locals.user ? await requestsFor(locals.user.did) : [];
  return { suffix: hostingDomainSuffix(), mine, subdomainRule: SUBDOMAIN_RULE };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!hostingEnabled()) error(404, 'Not found');
    if (!locals.user) return fail(401, { message: 'Log in before requesting a forum.' });
    const form = await request.formData();
    const code = String(form.get('code') ?? '').trim();
    const subdomain = String(form.get('subdomain') ?? '')
      .trim()
      .toLowerCase();
    const forumHandle = String(form.get('forumHandle') ?? '')
      .trim()
      .replace(/^@/, '');
    const email = String(form.get('email') ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, { message: 'That email address doesn\'t look right.' });
    }
    if (!code || !subdomain || !forumHandle) {
      return fail(400, { message: 'Fill in the invite code, subdomain, and forum account.' });
    }
    const forum = await resolveActor(forumHandle);
    if (!forum) {
      return fail(400, {
        message: `We couldn't find an account for ${forumHandle}. Create the forum account first, then try again.`,
      });
    }
    if (forum.did === locals.user.did) {
      return fail(400, {
        message: 'Use a separate account for the forum, not the one you\'re logged in with.',
      });
    }
    const result = await submitRequest({
      code,
      subdomain,
      forumHandle: forum.handle,
      forumDid: forum.did,
      requesterDid: locals.user.did,
      requesterHandle: locals.user.handle,
      email,
    });
    if ('error' in result) return fail(400, { message: result.error });
    return { submitted: true };
  },
};
