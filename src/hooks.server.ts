import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sessionDid } from '$lib/server/session';
import { resolveHandle } from '$lib/server/appview';
import { touchGuest, touchMember } from '$lib/server/presence';
import { assertProductionSecrets } from '$lib/server/secrets';

// Runs once when the server loads this module, so a production deploy with a
// forgeable session secret dies at startup instead of serving requests.
assertProductionSecrets(env);

export const handle: Handle = async ({ event, resolve }) => {
  const did = sessionDid(event.cookies);
  event.locals.user = did ? { did, handle: await resolveHandle(did) } : null;
  if (did) {
    touchMember(did);
  } else {
    try {
      touchGuest(event.getClientAddress(), event.request.headers.get('user-agent') ?? '');
    } catch {
      // no client address available (e.g. during prerender) — skip the count
    }
  }
  return resolve(event);
};
