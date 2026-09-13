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
import { getMembership, leaveForum } from '$lib/server/pds';
import { declareMembership } from '$lib/server/membership';
import { safeReturnPath } from '$lib/server/notify/return-path';
import { getPublicProfile } from '$lib/server/profiles';
import { presenceSnapshot } from '$lib/server/presence';
import { normalizeHomepage, rankHotThreads, selectFeaturedThreads } from '$lib/homepage';
import { neverAskedAboutNotifications } from '$lib/server/notify/store';

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
  // The same one-time offer the thread page makes after a first post, so a
  // member who never posts still finds it.
  const offerNotifications = locals.user ? await neverAskedAboutNotifications(locals.user.did) : false;
  try {
    const [index, feed] = await Promise.all([
      getBoardIndex(FORUM_DID()),
      // Homepage feeds are a bonus; a hiccup here shouldn't take down the board index.
      // This forum-scoped endpoint applies moderation, access, and federation filters.
      getLatestThreads(undefined, 100).catch((): LatestThreads => ({ threads: [] })),
    ]);
    const homepage = normalizeHomepage(index.forum?.homepage);
    const requestedView = url.searchParams.get('view');
    const homeView = requestedView === 'categories' || requestedView === 'latest' || requestedView === 'hot'
      ? requestedView
      : null;
    const top = index.boards.filter((b) => !b.value.parent);
    const childrenOf = (uri: string) => index.boards.filter((b) => b.value.parent === uri);
    const latest = feed.threads.slice(0, 15);
    // Honest bounded ranking: most replies among the 100 most recently active
    // visible topics, with recent activity as the tie-breaker.
    const hot = rankHotThreads(feed.threads).slice(0, 12);
    // Use the same visibility-filtered endpoint for older featured topics too:
    // selection must not silently disappear when a topic leaves the recent window.
    const featuredPages = await Promise.all(homepage.featuredThreads.map((uri) =>
      getLatestThreads(undefined, 1, FORUM_DID(), { uri }).catch((): LatestThreads => ({ threads: [] })),
    ));
    const featured = selectFeaturedThreads(featuredPages.flatMap((page) => page.threads), homepage.featuredThreads);

    // Authors in last-post columns without an atmobb profile get their handle
    const needsHandle = [
      ...new Set([
        ...index.boards
          .filter((b) => b.latest && !b.latest.authorProfile?.displayName)
          .map((b) => b.latest!.author),
        ...[...latest, ...hot, ...featured]
          .filter((t) => !t.authorProfile?.displayName)
          .map((t) => t.author),
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
      homepage,
      homeView,
      featured,
      latest,
      hot,
      stats: index.stats ?? { threads: 0, posts: 0, members: 0 },
      handles,
      offerNotifications,
      appviewDown: false,
    };
  } catch {
    return {
      metadata,
      groups: [] as { title: string; boards: never[] }[],
      presence,
      avatarProfiles,
      homepage: normalizeHomepage(undefined),
      homeView: null as 'categories' | 'latest' | 'hot' | null,
      featured: [] as LatestThreads['threads'],
      latest: [] as LatestThreads['threads'],
      hot: [] as LatestThreads['threads'],
      stats: { threads: 0, posts: 0, members: 0 },
      handles: {} as Record<string, string>,
      offerNotifications,
      appviewDown: true,
    };
  }
};

export const actions: Actions = {
  // Declares membership; a "Finish joining" notice elsewhere posts here too
  // with the page to return to. Declaring twice writes nothing the second time.
  join: async ({ locals, request }) => {
    if (!locals.user) redirect(303, '/login');
    const next = String((await request.formData()).get('next') ?? '');
    try {
      await declareMembership(locals.user.did, FORUM_DID());
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t add you to this forum. Try again.' });
    }
    redirect(303, safeReturnPath(next) ?? '/');
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
