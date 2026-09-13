import type { PageServerLoad } from './$types';
import { getMembers, resolveHandle } from '$lib/server/appview';
import { sponsorDids } from '$lib/stamps';

export const load: PageServerLoad = async ({ url }) => {
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const page = await getMembers(cursor);
  // A worn arrival stamp names its sponsor, so those handles resolve
  // alongside the members'. An unresolvable DID stays a DID and the stamp
  // reads as plain "brought in".
  const dids = new Set(page.members.map((m) => m.did));
  for (const m of page.members) for (const did of sponsorDids(m.stamps ?? [])) dids.add(did);
  const handles = Object.fromEntries(
    await Promise.all([...dids].map(async (did) => [did, await resolveHandle(did)] as const)),
  );
  return { ...page, handles };
};
