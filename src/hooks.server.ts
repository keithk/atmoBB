import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sessionDid } from '$lib/server/session';
import { resolveHandle } from '$lib/server/appview';
import { touchGuest, touchMember } from '$lib/server/presence';
import { assertProductionSecrets } from '$lib/server/secrets';
import { senderDid, senderKeypair } from '$lib/server/notify/sender';

// Runs once when the server loads this module, so a production deploy with a
// forgeable session secret dies at startup instead of serving requests.
assertProductionSecrets(env);

// The docs promise the sender key is minted on first boot and that a partial
// restore warns at startup, so load it now rather than on the first did.json
// or send. Unawaited: a slow disk must never delay the first request.
if (senderDid()) senderKeypair().catch((err) => console.error('[notify] could not load or create the sender key:', err));

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
