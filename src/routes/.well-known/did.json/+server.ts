import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { senderDidDocument } from '$lib/server/notify/sender';

// Serves this forum's atmo.pub sender identity. Only an https app URL has a
// resolvable did:web, so a dev or plain-http forum has no document to serve.
export const GET: RequestHandler = async () => {
  const doc = await senderDidDocument();
  if (!doc) error(404, 'This forum has no sender identity');
  return json(doc);
};
