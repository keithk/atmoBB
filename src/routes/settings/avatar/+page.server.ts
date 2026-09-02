import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { settingsPlugins } from 'virtual:atmobb/plugins/metadata';
import { profileImagePath } from '$lib/avatar/profile-image';
import { getActorProfile, saveProfile } from '$lib/server/pds';
import { bustProfileCache } from '$lib/server/profiles';

const MAX_AVATAR_BYTES = 200_000;

function isHundredPixelPng(bytes: Uint8Array): boolean {
  if (bytes.length < 24) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(16) === 100 && view.getUint32(20) === 100;
}

export const load: PageServerLoad = async ({ locals }) => {
  const provider = settingsPlugins.find((plugin) => plugin.section === 'avatar');
  if (provider) redirect(302, provider.href);

  if (!locals.user) redirect(302, '/login');
  const profile = await getActorProfile(locals.user.did);
  return {
    did: locals.user.did,
    currentAvatar: profileImagePath(locals.user.did, profile?.avatar),
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to save an avatar.' });

    const form = await request.formData();
    const avatar = form.get('avatar');
    if (!(avatar instanceof File) || avatar.size === 0) {
      return fail(400, { message: 'Build an avatar first.' });
    }
    if (avatar.type !== 'image/png' || avatar.size > MAX_AVATAR_BYTES) {
      return fail(400, { message: 'The rendered avatar must be a PNG under 200 KB.' });
    }

    const bytes = new Uint8Array(await avatar.arrayBuffer());
    if (!isHundredPixelPng(bytes)) {
      return fail(400, { message: 'The rendered avatar must be exactly 100 × 100 pixels.' });
    }

    try {
      await saveProfile(locals.user.did, { avatar: { bytes, mimeType: 'image/png' } });
      bustProfileCache(locals.user.did);
      return { saved: true };
    } catch (error) {
      return fail(502, { message: error instanceof Error ? error.message : 'We couldn\'t save your avatar. Try again.' });
    }
  },
};
