import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ringNeighbor } from '$lib/server/webring';

export const GET: RequestHandler = async ({ params }) => {
  if (params.dir !== 'next' && params.dir !== 'prev' && params.dir !== 'random') {
    error(404, "That webring link isn't valid.");
  }
  const url = await ringNeighbor(params.dir);
  // A ring of one loops home
  redirect(302, url ?? '/');
};
