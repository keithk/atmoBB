import type { PageServerLoad } from './$types';
import { getLatestThreads, resolveHandle } from '$lib/server/appview';

export const load: PageServerLoad = async ({ url }) => {
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const page = await getLatestThreads(cursor);
  const needsHandle = [
    ...new Set(page.threads.filter((t) => !t.authorProfile?.displayName).map((t) => t.author)),
  ];
  const handles = Object.fromEntries(
    await Promise.all(needsHandle.map(async (d) => [d, await resolveHandle(d)] as const)),
  );
  return { ...page, handles };
};
