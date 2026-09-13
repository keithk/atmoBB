import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { FORUM_DID, type ForumProfile } from '$lib/server/appview';
import { adminActor } from '$lib/server/admin';
import { uploadForumBlob } from '$lib/server/forum-repo';
import { blobCid, blobUrl } from '$lib/server/profiles';
import {
  currentProfile,
  imageMime,
  isOgPng,
  profileRedirect,
  saveProfile,
} from '$lib/server/forum-appearance';

const MAX_OG_IMAGE_BYTES = 2_000_000;
const MAX_FAVICON_BYTES = 1_000_000;
const HERE = '/admin/appearance/branding';

export const load: PageServerLoad = async () => {
  const profile = await currentProfile();
  const faviconCid = blobCid(profile.favicon);
  return {
    faviconCid,
    faviconUrl: faviconCid ? await blobUrl(FORUM_DID(), faviconCid) : null,
    ogImageCid: blobCid(profile.ogImage),
    hideCredit: profile.hideCredit === true,
  };
};

export const actions: Actions = {
  saveCredit: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const show = form.get('showCredit') === 'on';
    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      if (show) delete profile.hideCredit;
      else profile.hideCredit = true;
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the footer setting. Try again.' });
    }
    await profileRedirect(`${HERE}?saved=credit`, profile);
  },

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
    await profileRedirect(`${HERE}?saved=favicon`, profile);
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
    await profileRedirect(`${HERE}?saved=favicon-removed`, profile);
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
    await profileRedirect(`${HERE}?saved=og`, profile);
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
    await profileRedirect(`${HERE}?saved=og-removed`, profile);
  },
};
