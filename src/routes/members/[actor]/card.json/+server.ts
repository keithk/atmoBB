import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  resolveActor,
  getPublicProfile,
  getBskyProfile,
  presenceFor,
} from '$lib/server/profiles';
import { FORUM_DID, getStamps, resolveHandle } from '$lib/server/appview';
import { sponsorDids, wornFromTray } from '$lib/stamps';
import type { ProfileCard } from '$lib/profile-card';

export const GET: RequestHandler = async ({ params, locals }) => {
  const id = await resolveActor(params.actor);
  if (!id) error(404, 'Member not found.');

  // The stamp read starts with the rest; an appview error just leaves the
  // card without stamps rather than failing the hover.
  const [profile, bsky, stampSet] = await Promise.all([
    getPublicProfile(id.did, id.pds),
    getBskyProfile(id.did),
    getStamps(FORUM_DID(), id.did).catch(() => null),
  ]);

  // The arrival stamp names its sponsor, so that handle resolves here.
  const stamps = wornFromTray(stampSet?.tray ?? [], stampSet?.worn ?? []);
  const handles = Object.fromEntries(
    await Promise.all(sponsorDids(stamps).map(async (did) => [did, await resolveHandle(did)] as const)),
  );

  const card: ProfileCard = {
    did: id.did,
    handle: id.handle,
    displayName: profile?.displayName ?? id.handle,
    profile,
    presence: presenceFor(id.did),
    joined: profile?.createdAt ?? null,
    bsky: bsky ? { handle: bsky.handle } : null,
    isYou: locals.user?.did === id.did,
    stamps,
    handles,
  };

  return json(card, { headers: { 'cache-control': 'private, max-age=60' } });
};
