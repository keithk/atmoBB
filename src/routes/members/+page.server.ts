import type { PageServerLoad } from './$types';
import { getMembers, resolveHandle } from '$lib/server/appview';
import { joinMode, sponsorDisplay } from '$lib/membership';

export const load: PageServerLoad = async ({ url, parent }) => {
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const page = await getMembers(cursor);
  const { forum } = await parent();
  const gated = joinMode(forum.membership) !== 'open';
  // On a gated forum each row names its sponsor, so their handles resolve
  // alongside the members'. An unresolvable DID stays a DID and reads as
  // "a former member".
  const dids = new Set(page.members.map((m) => m.did));
  if (gated) for (const m of page.members) if (m.sponsor) dids.add(m.sponsor);
  const handles = Object.fromEntries(
    await Promise.all([...dids].map(async (did) => [did, await resolveHandle(did)] as const)),
  );
  const members = page.members.map((m) => {
    const sponsor =
      gated && m.since ? sponsorDisplay({ since: m.since, sponsor: m.sponsor, via: m.via }, handles) : null;
    return { ...m, sponsorText: sponsor?.text, sponsorHandle: sponsor?.handle ?? null };
  });
  return { ...page, members, handles, ranks: forum.ranks ?? [] };
};
