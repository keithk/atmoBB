import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ForumProfile } from '$lib/server/appview';
import { adminActor } from '$lib/server/admin';
import { uploadForumBlob } from '$lib/server/forum-repo';
import { blobCid } from '$lib/server/profiles';
import { currentProfile, fontMime, profileRedirect, saveProfile } from '$lib/server/forum-appearance';

const MAX_CSS_BYTES = 100_000;
const MAX_FONT_BYTES = 2_000_000;
const MAX_FONTS = 12;
const FAMILY = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;
const HERE = '/admin/appearance/css';

export const load: PageServerLoad = async () => {
  const profile = await currentProfile();
  const fonts = (profile.customFonts ?? []).flatMap((font) => {
    const cid = blobCid(font.source);
    if (!cid) return [];
    const source = font.source as { mimeType?: string; size?: number };
    return [{
      cid,
      family: font.family,
      weight: font.weight,
      style: font.style,
      mimeType: source.mimeType,
      size: source.size,
    }];
  });
  return {
    customCss: profile.customCss ?? '',
    fonts,
  };
};

export const actions: Actions = {
  saveCss: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const customCss = String(form.get('customCss') ?? '').trim();
    if (new TextEncoder().encode(customCss).length > MAX_CSS_BYTES) {
      return fail(413, { message: 'Custom CSS must be 100 KB or smaller.' });
    }
    if (/<\/style/i.test(customCss)) {
      return fail(400, { message: 'Custom CSS cannot contain a closing style tag.' });
    }

    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      if (customCss) profile.customCss = customCss;
      else delete profile.customCss;
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the CSS. Try again.' });
    }
    await profileRedirect(`${HERE}?saved=css`, profile);
  },

  uploadFont: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const file = form.get('font');
    const family = String(form.get('family') ?? '').trim();
    const weight = Number(form.get('weight'));
    const style = String(form.get('style') ?? 'normal');

    if (!FAMILY.test(family)) {
      return fail(400, { message: 'Font family must be 1–64 letters, numbers, spaces, dots, dashes, or underscores.' });
    }
    if (!Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0) {
      return fail(400, { message: 'Font weight must be a multiple of 100 from 100 to 900.' });
    }
    if (style !== 'normal' && style !== 'italic') {
      return fail(400, { message: 'Font style must be normal or italic.' });
    }
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, { message: 'Choose a WOFF or WOFF2 file.' });
    }
    if (file.size > MAX_FONT_BYTES) {
      return fail(413, { message: 'Font files must be 2 MB or smaller.' });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = fontMime(bytes);
    if (!mimeType) return fail(415, { message: 'That file is not WOFF or WOFF2.' });

    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      const fonts = profile.customFonts ?? [];
      if (fonts.length >= MAX_FONTS) {
        return fail(400, { message: `A forum can have at most ${MAX_FONTS} font faces.` });
      }
      const source = await uploadForumBlob(bytes, mimeType);
      profile.customFonts = [...fonts, { family, weight, style, source }];
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t upload the font. Try again.' });
    }
    await profileRedirect(`${HERE}?saved=font`, profile);
  },

  removeFont: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const cid = String(form.get('cid') ?? '');
    const family = String(form.get('family') ?? '');
    const weight = Number(form.get('weight'));
    const style = String(form.get('style') ?? '');
    if (!cid) return fail(400, { message: 'Font not found.' });

    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      const fonts = profile.customFonts ?? [];
      const index = fonts.findIndex((font) =>
        blobCid(font.source) === cid &&
        font.family === family &&
        font.weight === weight &&
        font.style === style
      );
      if (index < 0) return fail(404, { message: 'Font not found.' });
      const customFonts = fonts.toSpliced(index, 1);
      if (customFonts.length) profile.customFonts = customFonts;
      else delete profile.customFonts;
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t remove the font. Try again.' });
    }
    await profileRedirect(`${HERE}?saved=removed`, profile);
  },
};
