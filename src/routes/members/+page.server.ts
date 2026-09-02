import type { PageServerLoad } from './$types';
import { getMembers, resolveHandle } from '$lib/server/appview';

export const load: PageServerLoad = async ({ url, parent }) => {
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const page = await getMembers(cursor);
  const handles = Object.fromEntries(
    await Promise.all(page.members.map(async (m) => [m.did, await resolveHandle(m.did)] as const)),
  );
  const { forum } = await parent();
  return { ...page, handles, ranks: forum.ranks ?? [] };
};
