import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getLatestThreads, type ForumProfile } from '$lib/server/appview';
import { adminActor } from '$lib/server/admin';
import { currentProfile, profileRedirect, saveProfile } from '$lib/server/forum-appearance';
import {
  HOMEPAGE_LAYOUTS,
  HOMEPAGE_WELCOME_STYLES,
  homepageRecord,
  normalizeHomepage,
  threadUriFromReference,
  type HomepageLayout,
  type HomepageWelcome,
} from '$lib/homepage';

export const load: PageServerLoad = async () => {
  const profile = await currentProfile();
  const recentThreads = await getLatestThreads(undefined, 50).then((page) => page.threads).catch(() => []);
  return {
    homepage: normalizeHomepage(profile.homepage),
    recentThreads,
  };
};

export const actions: Actions = {
  saveHomepage: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const layout = String(form.get('layout') ?? '');
    const welcome = String(form.get('welcome') ?? '');
    if (!HOMEPAGE_LAYOUTS.includes(layout as HomepageLayout)) {
      return fail(400, { message: 'Choose a homepage layout.' });
    }
    if (!HOMEPAGE_WELCOME_STYLES.includes(welcome as HomepageWelcome)) {
      return fail(400, { message: 'Choose a welcome panel style.' });
    }
    const featuredReferences = form.get('featuredEnabled') === 'on'
      ? form.getAll('featuredThread').map(String).map((reference) => reference.trim()).filter(Boolean)
      : [];
    const featuredThreads = featuredReferences.map(threadUriFromReference);
    if (featuredReferences.length > 3 || featuredThreads.some((uri) => uri === null)) {
      return fail(400, { message: 'Choose up to three recent topics or paste valid topic URLs.' });
    }
    if (form.get('featuredEnabled') === 'on' && featuredThreads.length === 0) {
      return fail(400, { message: 'Choose at least one featured topic, or turn featured topics off.' });
    }
    if (new Set(featuredThreads).size !== featuredThreads.length) {
      return fail(400, { message: 'Choose each featured topic only once.' });
    }

    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      const homepage = homepageRecord({
        layout: layout as HomepageLayout,
        sidebar: form.get('sidebar') === 'on',
        welcome: welcome as HomepageWelcome,
        featuredThreads: featuredThreads as string[],
      });
      if (homepage) profile.homepage = homepage;
      else delete profile.homepage;
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the homepage settings. Try again.' });
    }
    await profileRedirect('/admin/appearance/homepage?saved=homepage', profile);
  },
};
