import type { PageServerLoad } from './$types';
import { FORUM_DID, getBoardIndex, getLatestThreads, resolveHandle, spaceOfBoard } from '$lib/server/appview';
import { threadFilters } from '$lib/thread-filters';

export const load: PageServerLoad = async ({ url }) => {
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const filters = threadFilters(url.searchParams);
  const [page, index] = await Promise.all([
    getLatestThreads(cursor, 25, FORUM_DID(), filters),
    getBoardIndex(FORUM_DID()).catch(() => ({ boards: [] })),
  ]);
  const needsHandle = [
    ...new Set(page.threads.filter((t) => !t.authorProfile?.displayName).map((t) => t.author)),
  ];
  const handles = Object.fromEntries(
    await Promise.all(needsHandle.map(async (d) => [d, await resolveHandle(d)] as const)),
  );
  return {
    ...page,
    handles,
    filters,
    forumDid: FORUM_DID(),
    boards: index.boards
      .filter((board) => !spaceOfBoard(board.value.access))
      .map((board) => ({ uri: board.uri, name: board.value.name })),
  };
};
