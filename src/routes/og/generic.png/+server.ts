import type { RequestHandler } from './$types';
import { renderPng, pngResponse } from '$lib/server/og/render';
import { genericCard } from '$lib/server/og/cards';

// The universal fallback card — pure brand, no per-page data. Used as the
// default og:image for every page that doesn't ship its own.
export const GET: RequestHandler = async ({ url }) => {
  const png = await renderPng(genericCard({ host: url.host }));
  return pngResponse(png, 3600);
};
