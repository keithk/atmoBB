import type { RequestHandler } from './$types';
import { FORUM_DID } from '$lib/server/appview';

// Serves the forum account's DID so that account can verify this site's
// domain as its handle. Handle-as-domain is what the webring and
// cross-forum thread links assume when they build forum URLs.
export const GET: RequestHandler = () =>
  new Response(FORUM_DID(), { headers: { 'content-type': 'text/plain' } });
