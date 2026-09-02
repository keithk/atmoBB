import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBoardIndex, FORUM_DID, type ForumFont, type ForumProfile } from '$lib/server/appview';
import { adminActor } from '$lib/server/admin';
import { putForumRecord, uploadForumBlob } from '$lib/server/forum-repo';
import { savedRedirect } from '$lib/server/saved-redirect';
import { blobCid, blobUrl } from '$lib/server/profiles';

const PROFILE = 'app.atmobb.forum.profile';
const MAX_CSS_BYTES = 100_000;
const MAX_FONT_BYTES = 2_000_000;
const MAX_OG_IMAGE_BYTES = 2_000_000;
const MAX_FAVICON_BYTES = 1_000_000;
const MAX_FONTS = 12;
const FAMILY = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;
const OG_THEMES = new Set(['classic', 'midnight', 'ocean', 'forest', 'plum']);

async function currentProfile(): Promise<ForumProfile> {
  const index = await getBoardIndex(FORUM_DID());
  if (!index.forum) throw new Error('forum profile not found');
  return index.forum;
}

async function saveProfile(profile: ForumProfile) {
  await putForumRecord(PROFILE, 'self', profile);
}

// Comparable identity of a font list across the write and index shapes (the
// SDK's BlobRef serializes differently from the indexed record's $link JSON).
const fontFingerprint = (fonts?: ForumFont[]) =>
  JSON.stringify((fonts ?? []).map((f) => [blobCid(f.source), f.family, f.weight, f.style]));

// Hold the redirect until the saved profile is visible in the index.
const profileRedirect = (dest: string, saved: ForumProfile) =>
  savedRedirect(
    dest,
    () => getBoardIndex(FORUM_DID()),
    (i) =>
      !!i.forum &&
      (i.forum.customCss ?? '') === (saved.customCss ?? '') &&
      fontFingerprint(i.forum.customFonts) === fontFingerprint(saved.customFonts) &&
      blobCid(i.forum.favicon) === blobCid(saved.favicon) &&
      blobCid(i.forum.ogImage) === blobCid(saved.ogImage) &&
      (i.forum.ogTheme ?? 'classic') === (saved.ogTheme ?? 'classic'),
  );

function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function isOgPng(bytes: Uint8Array): boolean {
  if (bytes.length < 24) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(16) === 1200 && view.getUint32(20) === 630;
}

function fontMime(bytes: Uint8Array): 'font/woff' | 'font/woff2' | null {
  if (bytes.length < 4) return null;
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (signature === 'wOFF') return 'font/woff';
  if (signature === 'wOF2') return 'font/woff2';
  return null;
}

export const load: PageServerLoad = async () => {
  const profile = await currentProfile();
  const faviconCid = blobCid(profile.favicon);
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
    faviconCid,
    faviconUrl: faviconCid ? await blobUrl(FORUM_DID(), faviconCid) : null,
    ogImageCid: blobCid(profile.ogImage),
    ogTheme: OG_THEMES.has(profile.ogTheme ?? '') ? profile.ogTheme : 'classic',
  };
};

export const actions: Actions = {
  uploadFavicon: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const file = form.get('favicon');
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, { message: 'Choose a PNG, JPEG, or WebP favicon.' });
    }
    if (file.size > MAX_FAVICON_BYTES) {
      return fail(413, { message: 'Favicons must be 1 MB or smaller.' });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = imageMime(bytes);
    if (!mimeType) {
      return fail(415, { message: 'The favicon must be a PNG, JPEG, or WebP image.' });
    }

    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      profile.favicon = await uploadForumBlob(bytes, mimeType);
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t upload the favicon. Try again.' });
    }
    await profileRedirect('/admin/appearance?saved=favicon', profile);
  },

  removeFavicon: async ({ locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      delete profile.favicon;
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t restore the default favicon. Try again.' });
    }
    await profileRedirect('/admin/appearance?saved=favicon-removed', profile);
  },

  saveOgTheme: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const ogTheme = String(form.get('ogTheme') ?? '');
    if (!OG_THEMES.has(ogTheme)) return fail(400, { message: 'Choose a social preview style.' });

    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      if (ogTheme === 'classic') delete profile.ogTheme;
      else profile.ogTheme = ogTheme;
      delete profile.ogImage;
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the social preview style. Try again.' });
    }
    await profileRedirect('/admin/appearance?saved=og-theme', profile);
  },

  uploadOgImage: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const file = form.get('ogImage');
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, { message: 'Choose a PNG social preview image.' });
    }
    if (file.size > MAX_OG_IMAGE_BYTES) {
      return fail(413, { message: 'Social preview images must be 2 MB or smaller.' });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isOgPng(bytes)) {
      return fail(415, { message: 'The social preview must be a 1200 × 630 PNG.' });
    }

    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      profile.ogImage = await uploadForumBlob(bytes, 'image/png');
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t upload the social preview. Try again.' });
    }
    await profileRedirect('/admin/appearance?saved=og', profile);
  },

  removeOgImage: async ({ locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      delete profile.ogImage;
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t restore the default social preview. Try again.' });
    }
    await profileRedirect('/admin/appearance?saved=og-removed', profile);
  },

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
    await profileRedirect('/admin/appearance?saved=css', profile);
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
    await profileRedirect('/admin/appearance?saved=font', profile);
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
    await profileRedirect('/admin/appearance?saved=removed', profile);
  },
};
