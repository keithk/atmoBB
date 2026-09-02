import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FORUM_DID, getBoardIndex } from '$lib/server/appview';

export const GET: RequestHandler = async () => {
  let name = 'atmobb';
  let description = 'An independent forum on the atmosphere.';
  try {
    const forum = (await getBoardIndex(FORUM_DID())).forum;
    name = forum?.name?.trim() || name;
    description = forum?.description?.trim() || description;
  } catch {
    // The manifest remains useful while the appview is temporarily unavailable.
  }

  return json(
    {
      id: '/',
      name,
      short_name: [...name].slice(0, 24).join(''),
      description,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#eceae7',
      theme_color: '#eceae7',
      lang: 'en',
      categories: ['social'],
      icons: [
        {
          src: '/favicon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any',
        },
      ],
    },
    {
      headers: {
        'content-type': 'application/manifest+json',
        'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
      },
    },
  );
};
