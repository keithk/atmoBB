import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  hostingEnabled,
  hostingDomainSuffix,
  hostingPage,
  requestsFor,
  checkProvisioning,
  submitRequest,
  SUBDOMAIN_RULE,
} from '$lib/server/hosting';
import { resolveActor } from '$lib/server/profiles';

export const load: PageServerLoad = async ({ locals }) => {
  if (!hostingEnabled()) error(404, 'Not found');
  // Refresh only after sign-in; do not expose operator errors or fleet data.
  if (locals.user) await checkProvisioning().catch(() => {});
  const [mine, page] = await Promise.all([
    locals.user ? requestsFor(locals.user.did) : [],
    hostingPage(),
  ]);
  return { suffix: hostingDomainSuffix(), mine, page, subdomainRule: SUBDOMAIN_RULE };
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
    const about = String(form.get('about') ?? '').trim();
    const aboutUrl = String(form.get('aboutUrl') ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, { message: 'That email address doesn\'t look right.' });
    }
    if (about.length > 500) {
      return fail(400, { message: 'Keep what you\'re building to 500 characters.' });
    }
    if (aboutUrl && (aboutUrl.length > 300 || !URL.canParse(aboutUrl) || !/^https?:$/.test(new URL(aboutUrl).protocol))) {
      return fail(400, { message: 'The link needs to be a full http:// or https:// address.' });
    }
    const { requireInvite } = await hostingPage();
    if ((requireInvite && !code) || !subdomain || !forumHandle) {
      return fail(400, {
        message: requireInvite
          ? 'Fill in the invite code, subdomain, and forum account.'
          : 'Fill in the subdomain and forum account.',
      });
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
      about,
      aboutUrl,
    });
    if ('error' in result) return fail(400, { message: result.error });
    return { submitted: true };
  },
};
