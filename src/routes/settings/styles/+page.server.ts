import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { FORUM_DID } from '$lib/server/appview';
import { getActorProfile, saveProfile, type ProfileEdit } from '$lib/server/pds';
import { FORUM_THEMES, forumThemeOverride, type ForumTheme } from '$lib/themes';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, '/login');
  const profile = await getActorProfile(locals.user.did);
  return {
    globalTheme: FORUM_THEMES.includes(profile?.theme as ForumTheme) ? profile!.theme as ForumTheme : '',
    localTheme: forumThemeOverride(profile?.forumThemes, FORUM_DID()) ?? 'inherit',
  };
};

export const actions: Actions = {
  default: async ({ locals, request }) => {
    if (!locals.user) return fail(401, { message: 'Log in to edit your styles.' });
    const fd = await request.formData();
    const scope = fd.get('scope');
    const theme = String(fd.get('theme') ?? '');
    if (scope !== 'forum' && scope !== 'all') return fail(400, { message: 'Choose where to apply your theme.' });
    if (theme !== '' && !(scope === 'forum' && theme === 'inherit') && !FORUM_THEMES.includes(theme as ForumTheme)) {
      return fail(400, { message: 'Choose a valid theme.' });
    }
    try {
      if (scope === 'all') {
        await saveProfile(locals.user.did, { theme: theme as ForumTheme | '' });
      } else {
        const profile = await getActorProfile(locals.user.did);
        const forumThemes = (Array.isArray(profile?.forumThemes) ? profile.forumThemes : [])
          .filter((entry) => entry.forum !== FORUM_DID()) as NonNullable<ProfileEdit['forumThemes']>;
        if (theme !== 'inherit') forumThemes.push({ forum: FORUM_DID(), theme: theme as ForumTheme | '' });
        await saveProfile(locals.user.did, { forumThemes });
      }
      return { saved: true, scope };
    } catch (error) {
      return fail(502, { message: error instanceof Error ? error.message : 'Could not save styles. Try again.' });
    }
  },
};
