import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ForumProfile } from '$lib/server/appview';
import { adminActor } from '$lib/server/admin';
import { currentProfile, profileRedirect, saveProfile } from '$lib/server/forum-appearance';
import { DEFAULT_THEME, FORUM_THEMES, normalizeTheme, type ForumTheme } from '$lib/themes';

export const load: PageServerLoad = async () => {
  const profile = await currentProfile();
  return {
    theme: normalizeTheme(profile.theme),
    forumName: profile.name,
  };
};

export const actions: Actions = {
  saveTheme: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const theme = String(form.get('theme') ?? '');
    if (!FORUM_THEMES.includes(theme as ForumTheme)) return fail(400, { message: 'Choose a theme.' });

    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      // Omit the default so old and new records read the same way.
      if (theme === DEFAULT_THEME) delete profile.theme;
      else profile.theme = theme;
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the theme. Try again.' });
    }
    await profileRedirect('/admin/appearance?saved=theme', profile);
  },
};
