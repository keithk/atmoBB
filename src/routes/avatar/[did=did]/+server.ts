import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBskyProfile } from '$lib/server/profiles';
import { isPublicHostname } from '$lib/server/extensions/outbound';

export const GET: RequestHandler = async ({ params }) => {
  const avatar = (await getBskyProfile(params.did))?.avatar;
  if (!avatar) error(404, 'Avatar not found.');
  let url: URL;
  try {
    url = new URL(avatar);
  } catch {
    error(404, 'Avatar not found.');
  }
  if (url.protocol !== 'https:' || !(await isPublicHostname(url.hostname))) error(404, 'Avatar not found.');

  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      'cache-control': 'public, max-age=300',
    },
  });
};
