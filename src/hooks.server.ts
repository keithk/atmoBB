import type { Handle, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { sessionDid } from '$lib/server/session';
import { resolveHandle } from '$lib/server/appview';
import { touchGuest, touchMember } from '$lib/server/presence';
import { assertProductionSecrets } from '$lib/server/secrets';
import { senderDid, senderKeypair } from '$lib/server/notify/sender';
import { acquireExtensionsLock } from '$lib/server/extensions/lock';
import { startScheduler } from '$lib/server/extensions/scheduler';
import { dispatchTimer } from '$lib/server/extensions/host';
import { startMaintenance } from '$lib/server/extensions/maintenance';
import { rebuildBindingsInBackground } from '$lib/server/extensions/bindings';

// Runs once when the server loads this module, so a production deploy with a
// forgeable session secret dies at startup instead of serving requests.
assertProductionSecrets(env);

// The docs promise the sender key is minted on first boot and that a partial
// restore warns at startup, so load it now rather than on the first did.json
// or send. Unawaited: a slow disk must never delay the first request.
if (senderDid()) senderKeypair().catch((err) => console.error('[notify] could not load or create the sender key:', err));

// If a deploy ever runs old and new containers against the same DATA_DIR,
// only the process holding the extensions lock runs the timer poller; one
// that can't get it serves requests with extensions disabled rather than
// double-firing timers or racing another writer. The same process purges
// uninstalled extensions' data once their grace period ends, and rebuilds the
// thread binding cache from the forum repo, since page views only ever read
// that cache. Skipped during
// `vite build`/prerender, which imports this module without ever serving.
export const init: ServerInit = async () => {
  if (building) return;
  const lock = await acquireExtensionsLock();
  if (!lock) return;
  startScheduler({ dispatch: dispatchTimer });
  startMaintenance();
  rebuildBindingsInBackground();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => lock.release());
  }
};

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
