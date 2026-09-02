import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getActorProfile, saveProfile } from '$lib/server/pds';
import { blobCid, bustProfileCache } from '$lib/server/profiles';
import type { RichTextBlock } from '$lib/richtext/bbcode';
import { attachImages, resolveBodyImages } from '$lib/server/richtext';

const SIG_BLOCK = 'app.atmobb.richtext.block#text';
const SIG_IMAGE_BLOCK = 'app.atmobb.richtext.block#image';
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_AVATAR_BYTES = 1_000_000;

function imageKeys(imagesRaw: string, orderRaw: string): string[] {
  try {
    const order = JSON.parse(orderRaw);
    if (Array.isArray(order)) return order.filter((key): key is string => typeof key === 'string');
  } catch {
    // Fall back to the payload keys for clients that don't submit an order.
  }
  try {
    const images = JSON.parse(imagesRaw);
    return images && typeof images === 'object' && !Array.isArray(images) ? Object.keys(images) : [];
  } catch {
    return [];
  }
}

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, '/login');
  const profile = await getActorProfile(locals.user.did);
  const signature = (profile?.signature ?? []) as RichTextBlock[];
  await resolveBodyImages([{ author: locals.user.did, body: signature }]);
  const sigText =
    signature.filter((block) => !block.$type.endsWith('#image')).map((block) => block.text ?? '').join('\n');
  const signatureImages = signature.flatMap((block, index) => {
    if (!block.$type.endsWith('#image')) return [];
    const cid = blobCid(block.image);
    return cid ? [{ key: `${cid}:${index}`, cid, blob: block.image, url: block.url, alt: block.alt ?? '' }] : [];
  });
  return {
    handle: locals.user.handle,
    did: locals.user.did,
    avatarProfile: profile,
    profile: {
      displayName: profile?.displayName ?? '',
      description: profile?.description ?? '',
      signature: sigText,
      signatureImages,
      pronouns: profile?.pronouns ?? '',
      website: profile?.website ?? '',
    },
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to edit your profile.' });
    const fd = await request.formData();
    const displayName = String(fd.get('displayName') ?? '').trim();
    const description = String(fd.get('description') ?? '').trim();
    const sigText = String(fd.get('signature') ?? '').trim();
    const signatureImagesRaw = String(fd.get('signature__images') ?? '');
    const signatureImageOrderRaw = String(fd.get('signature__image_order') ?? '');
    const pronouns = String(fd.get('pronouns') ?? '').trim();
    const website = String(fd.get('website') ?? '').trim();
    const avatarFile = fd.get('avatar');

    if (website && !/^https?:\/\//i.test(website)) {
      return fail(400, { message: 'Website must start with http:// or https://.' });
    }
    if (avatarFile instanceof File && avatarFile.size > MAX_AVATAR_BYTES) {
      return fail(400, { message: 'Avatar images must be 1 MB or smaller.' });
    }
    if (avatarFile instanceof File && avatarFile.size > 0 && !AVATAR_TYPES.has(avatarFile.type)) {
      return fail(400, { message: 'Avatar images must be PNG, JPEG, WebP, or GIF.' });
    }

    const signature = attachImages(
      [
        ...(sigText ? [{ $type: SIG_BLOCK, text: sigText }] : []),
        ...imageKeys(signatureImagesRaw, signatureImageOrderRaw).map((key) => ({ $type: SIG_IMAGE_BLOCK, cid: key })),
      ],
      signatureImagesRaw,
    );
    if (signature.length > 3) {
      return fail(400, { message: 'Signatures can contain up to three text or image blocks.' });
    }
    const avatar = avatarFile instanceof File && avatarFile.size > 0
      ? {
          bytes: new Uint8Array(await avatarFile.arrayBuffer()),
          mimeType: avatarFile.type as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
        }
      : undefined;

    try {
      await saveProfile(locals.user.did, { displayName, description, signature, pronouns, website, avatar });
      bustProfileCache(locals.user.did);
      return { saved: true };
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save your profile. Try again.' });
    }
  },
};
