import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  resolveActor,
  getPublicProfile,
  getAtmobbActivity,
  getBskyProfile,
  getForumRanks,
  presenceFor,
} from '$lib/server/profiles';
import { rankFor } from '$lib/rank';
import type { ProfileCard } from '$lib/profile-card';

export const GET: RequestHandler = async ({ params, locals }) => {
  const id = await resolveActor(params.actor);
  if (!id) error(404, 'Member not found.');

  const [profile, activity, bsky, ranks] = await Promise.all([
    getPublicProfile(id.did, id.pds),
    getAtmobbActivity(id.did),
    getBskyProfile(id.did),
    getForumRanks(),
  ]);

  const posts = activity.local.posts || null;
  const card: ProfileCard = {
    did: id.did,
    handle: id.handle,
    displayName: profile?.displayName ?? id.handle,
    profile,
    presence: presenceFor(id.did),
    posts,
    globalPosts: activity.global.posts || null,
    rankTitle: posts != null ? rankFor(ranks, posts).title : '',
    joined: profile?.createdAt ?? null,
    bsky: bsky ? { handle: bsky.handle } : null,
    isYou: locals.user?.did === id.did,
  };

  return json(card, { headers: { 'cache-control': 'private, max-age=60' } });
};
