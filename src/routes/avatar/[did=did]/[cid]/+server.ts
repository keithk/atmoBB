import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { blobUrl } from '$lib/server/profiles';

const CID = /^[A-Za-z0-9]+$/;

export const GET: RequestHandler = async ({ params }) => {
  if (!CID.test(params.cid)) error(400, "That avatar link isn't valid.");
  const target = await blobUrl(params.did, params.cid);
  if (!target) error(404, 'Avatar not found.');
  redirect(302, target);
};
