import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBskyProfile } from '$lib/server/profiles';

export const GET: RequestHandler = async ({ params }) => {
  const avatar = (await getBskyProfile(params.did))?.avatar;
  if (!avatar) error(404, 'Avatar not found.');

  return new Response(null, {
    status: 302,
    headers: {
      location: avatar,
      'cache-control': 'public, max-age=300',
    },
  });
};
