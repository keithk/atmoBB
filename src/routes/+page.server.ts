import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  getBoardIndex,
  getLatestThreads,
  FORUM_DID,
  resolveHandle,
  spaceOfBoard,
  isSpaceMember,
} from '$lib/server/appview';
import type { ActorProfile, LatestThreads } from '$lib/server/appview';
import { readSpaceBoardThreads } from '$lib/server/space-read';
import { getMembership, joinForum, leaveForum } from '$lib/server/pds';
import { getPublicProfile } from '$lib/server/profiles';
import { presenceSnapshot } from '$lib/server/presence';

// Real profiles for the who's-online members (cached in getPublicProfile).
async function presenceProfiles(dids: string[]): Promise<Record<string, ActorProfile | null>> {
  const entries = await Promise.all(
    dids.map(async (d) => [d, await getPublicProfile(d)] as const),
  );
  return Object.fromEntries(entries);
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const metadata = {
    image: `${url.origin}/og/forum.png`,
    imageAlt: 'Forum overview',
    type: 'website' as const,
    noindex: false,
  };
  const presence = presenceSnapshot();
  const avatarProfiles = await presenceProfiles(presence.members.map((m) => m.did));
  try {
    const [index, latest] = await Promise.all([
      getBoardIndex(FORUM_DID()),
      // Hot threads are a bonus section; a hiccup here shouldn't take down the index
      getLatestThreads(undefined, 8).catch((): LatestThreads => ({ threads: [] })),
    ]);
    const top = index.boards.filter((b) => !b.value.parent);
    const childrenOf = (uri: string) => index.boards.filter((b) => b.value.parent === uri);
    const hot = latest.threads.filter((t) => t.replyCount > 0).slice(0, 3);

    // Authors in last-post columns without an atmobb profile get their handle
    const needsHandle = [
      ...new Set([
        ...index.boards
          .filter((b) => b.latest && !b.latest.authorProfile?.displayName)
          .map((b) => b.latest!.author),
        ...hot.filter((t) => !t.authorProfile?.displayName).map((t) => t.author),
        ...(index.stats?.newestMember ? [index.stats.newestMember.did] : []),
        ...presence.members.map((m) => m.did),
      ]),
    ];
    const handles = Object.fromEntries(
      await Promise.all(needsHandle.map(async (d) => [d, await resolveHandle(d)] as const)),
    );

    const boards = top.map((b) => ({ ...b, children: childrenOf(b.uri), locked: false }));

    // Members-only boards: real content lives in the permissioned space, not the
    // public index (which zeroes them out). A member sees the true count +
    // latest, read live from the space; everyone else gets a locked row with no
    // content preview.
    await Promise.all(
      boards.map(async (b) => {
        const space = spaceOfBoard(b.value.access);
        if (!space) return;
        const member = locals.user ? await isSpaceMember(space, locals.user.did) : false;
        if (!member) {
          b.locked = true;
          return;
        }
        try {
          const sb = await readSpaceBoardThreads(locals.user!.did, space, undefined);
          b.threadCount = sb.threads.length;
          b.replyCount = sb.threads.reduce((n, t) => n + (t.replyCount ?? 0), 0);
          const t0 = sb.threads[0];
          b.latest = t0
            ? { uri: t0.uri, title: t0.title, author: t0.author, authorProfile: t0.authorProfile, at: t0.lastActivity }
            : undefined;
          b.latestActivity = t0?.lastActivity;
        } catch {
          // space read hiccup — leave it enterable with no preview
        }
      }),
    );

    const categories = index.categories ?? [];
    const grouped = new Set(categories.map((c) => c.uri));
    const groups = [
      ...categories.map((c) => ({
        title: c.value.name,
        boards: boards.filter((b) => b.value.category === c.uri),
      })),
      // Boards without a category (or pointing at one that doesn't exist)
      { title: 'Boards', boards: boards.filter((b) => !b.value.category || !grouped.has(b.value.category)) },
    ].filter((g) => g.boards.length);

    return {
      metadata,
      groups,
      presence,
      avatarProfiles,
      hot,
      stats: index.stats ?? { threads: 0, posts: 0, members: 0 },
      handles,
      appviewDown: false,
    };
  } catch {
    return {
      metadata,
      groups: [] as { title: string; boards: never[] }[],
      presence,
      avatarProfiles,
      hot: [] as LatestThreads['threads'],
      stats: { threads: 0, posts: 0, members: 0 },
      handles: {} as Record<string, string>,
      appviewDown: true,
    };
  }
};

export const actions: Actions = {
  join: async ({ locals }) => {
    if (!locals.user) redirect(303, '/login');
    try {
      await joinForum(locals.user.did, FORUM_DID());
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t add you to this forum. Try again.' });
    }
    redirect(303, '/');
  },
  leave: async ({ locals }) => {
    if (!locals.user) redirect(303, '/login');
    const membership = await getMembership(locals.user.did, FORUM_DID());
    if (!membership?.uri) return fail(400, { message: "You aren't a member of this forum." });
    try {
      await leaveForum(locals.user.did, membership.uri);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t remove you from this forum. Try again.' });
    }
    redirect(303, '/');
  },
};
