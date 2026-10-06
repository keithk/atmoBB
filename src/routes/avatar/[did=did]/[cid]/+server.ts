import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { blobUrl } from '$lib/server/profiles';
import { isPublicHostname } from '$lib/server/extensions/outbound';

const CID = /^[A-Za-z0-9]+$/;

export const GET: RequestHandler = async ({ params }) => {
  if (!CID.test(params.cid)) error(400, "That avatar link isn't valid.");
  const target = await blobUrl(params.did, params.cid);
  if (!target) error(404, 'Avatar not found.');
  // blobUrl is HTTPS and host-vetted, but don't bounce a browser to a PDS that
  // resolves onto the shard's own network.
  if (!(await isPublicHostname(new URL(target).hostname))) error(404, 'Avatar not found.');
  redirect(302, target);
};
