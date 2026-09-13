import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  resolveActor,
  getPublicProfile,
  getAtmobbActivity,
  getBskyProfile,
  getForumProfile,
  presenceFor,
} from '$lib/server/profiles';
import { getMembership, resolveHandle } from '$lib/server/appview';
import { rankFor } from '$lib/rank';
import { joinMode, sponsorDisplay } from '$lib/membership';
import type { ProfileCard } from '$lib/profile-card';

export const GET: RequestHandler = async ({ params, locals }) => {
  const id = await resolveActor(params.actor);
  if (!id) error(404, 'Member not found.');

  // The acceptance read starts with the rest and is discarded on an open
  // forum, rather than adding a sequential round-trip to every hover on a
  // gated one.
  const [profile, activity, bsky, forum, membership] = await Promise.all([
    getPublicProfile(id.did, id.pds),
    getAtmobbActivity(id.did),
    getBskyProfile(id.did),
    getForumProfile(),
    getMembership(id.did).catch(() => null),
  ]);
  const ranks = forum?.ranks ?? [];

  // On a gated forum the card names the sponsor, the same line the member
  // list shows. No open acceptance (or an appview error) just leaves it off.
  let sponsor: ProfileCard['sponsor'] = null;
  if (joinMode(forum?.membership) !== 'open' && membership?.accepted && membership.since) {
    const window = { since: membership.since, sponsor: membership.sponsor, via: membership.via };
    const handle = window.sponsor ? await resolveHandle(window.sponsor) : null;
    sponsor = sponsorDisplay(window, window.sponsor ? { [window.sponsor]: handle } : {});
  }

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
    sponsor,
  };

  return json(card, { headers: { 'cache-control': 'private, max-age=60' } });
};
