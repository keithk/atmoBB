import type { RequestHandler } from './$types';
import { renderPng, pngResponse } from '$lib/server/og/render';
import { forumCard, genericCard } from '$lib/server/og/cards';
import { getBoardIndex, FORUM_DID } from '$lib/server/appview';
import { presenceSnapshot } from '$lib/server/presence';
import { blobCid, blobUrl } from '$lib/server/profiles';
import { ogSkin } from '$lib/server/og/palette';

async function customImage(image: unknown): Promise<Uint8Array<ArrayBuffer> | null> {
  const cid = blobCid(image);
  if (!cid) return null;
  try {
    const source = await blobUrl(FORUM_DID(), cid);
    if (!source) return null;
    const response = await fetch(source, { signal: AbortSignal.timeout(5000) });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/png') return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length <= 2_000_000 ? bytes : null;
  } catch {
    return null;
  }
}

// The forum-landing card (home page): who lives here and how big the room is.
export const GET: RequestHandler = async ({ url }) => {
  try {
    const index = await getBoardIndex(FORUM_DID());
    const previewTheme = url.searchParams.get('previewTheme');
    const custom = previewTheme ? null : await customImage(index.forum?.ogImage);
    if (custom) return pngResponse(custom, 300);
    const snap = presenceSnapshot();
    const online = snap.members.filter((m) => m.presence === 'online').length + snap.guests;
    const png = await renderPng(
      forumCard({
        name: index.forum?.name ?? 'atmobb',
        handle: url.host,
        tagline: index.forum?.description,
        members: index.stats?.members ?? 0,
        boards: index.boards?.length ?? 0,
        online,
        skin: ogSkin(previewTheme ?? index.forum?.ogTheme),
      }),
    );
    return pngResponse(png, 300);
  } catch {
    // Appview down — still hand crawlers a valid brand card.
    const png = await renderPng(genericCard({ host: url.host }));
    return pngResponse(png, 60);
  }
};
