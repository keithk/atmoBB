import type { RequestHandler } from './$types';
import { renderPng, pngResponse } from '$lib/server/og/render';
import { memberCard, genericCard } from '$lib/server/og/cards';
import {
  resolveActor,
  getPublicProfile,
  getAtmobbActivity,
  getForumRanks,
  presenceFor,
} from '$lib/server/profiles';
import { profileAvatarNode } from '$lib/server/og/avatar';
import { rankFor } from '$lib/rank';
import type { RichTextBlock } from '$lib/server/appview';

const signatureText = (blocks?: RichTextBlock[]): string =>
  (blocks ?? [])
    .map((b) => b.text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

export const GET: RequestHandler = async ({ params, url, fetch }) => {
  try {
    const id = await resolveActor(params.actor);
    if (!id) throw new Error('no member');

    const [profile, activity, ranks] = await Promise.all([
      getPublicProfile(id.did, id.pds),
      getAtmobbActivity(id.did),
      getForumRanks(),
    ]);

    const localPosts = activity.local.posts || null;
    const posts = activity.global.posts || null;
    const avatar = await profileAvatarNode(
      profile,
      id.did,
      fetch,
      { size: 150, ring: true, presence: presenceFor(id.did) },
      profile?.displayName ?? id.handle,
    );

    const png = await renderPng(
      memberCard({
        displayName: profile?.displayName ?? id.handle,
        handle: id.handle,
        avatar,
        rank: localPosts != null ? rankFor(ranks, localPosts).title || undefined : undefined,
        posts,
        joined: profile?.createdAt ? String(new Date(profile.createdAt).getFullYear()) : null,
        signature: signatureText(profile?.signature) || undefined,
      }),
    );
    return pngResponse(png, 300);
  } catch {
    const png = await renderPng(genericCard({ host: url.host }));
    return pngResponse(png, 60);
  }
};
