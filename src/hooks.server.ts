import type { Handle, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { sessionDid } from '$lib/server/session';
import { resolveHandle } from '$lib/server/appview';
import { touchGuest, touchMember } from '$lib/server/presence';
import { assertProductionSecrets } from '$lib/server/secrets';
import { senderDid, senderKeypair } from '$lib/server/notify/sender';
import { waitForExtensionsLock, type ExtensionsLock, type ExtensionsLockWait } from '$lib/server/extensions/lock';
import { startScheduler } from '$lib/server/extensions/scheduler';
import { closeExtensionHost, dispatchTimer } from '$lib/server/extensions/host';
import { startMaintenance } from '$lib/server/extensions/maintenance';
import { rebuildBindingsInBackground } from '$lib/server/extensions/bindings';
import { isFramePath } from '$lib/server/extensions/frame';

// Runs once when the server loads this module, so a production deploy with a
// forgeable session secret dies at startup instead of serving requests.
assertProductionSecrets(env);

// The docs promise the sender key is minted on first boot and that a partial
// restore warns at startup, so load it now rather than on the first did.json
// or send. Unawaited: a slow disk must never delay the first request.
if (senderDid()) senderKeypair().catch((err) => console.error('[notify] could not load or create the sender key:', err));

let waiting: ExtensionsLockWait | null = null;
let running: { lock: ExtensionsLock; stop(): void } | null = null;
let shuttingDown = false;

// If a deploy ever runs old and new containers against the same DATA_DIR,
// only the process holding the extensions lock runs the timer poller; one
// that can't get it serves requests with extensions disabled rather than
// double-firing timers or racing another writer, and keeps trying until the
// holder lets go. The same process purges
// uninstalled extensions' data once their grace period ends, and rebuilds the
// thread binding cache from the forum repo, since page views only ever read
// that cache. Skipped during
// `vite build`/prerender, which imports this module without ever serving.
export const init: ServerInit = async () => {
  if (building) return;
  // adapter-node emits this once in-flight requests have drained, so they
  // still find extensions running. Vite dev never emits it; there the exit
  // handler releases the lock when vite exits, and a dev server killed
  // outright leaves a lock the next start takes over once it goes stale.
  process.once('sveltekit:shutdown', () => void stopExtensions());
  process.once('exit', () => running?.lock.release());
  await waitForLock();
};

function waitForLock() {
  waiting = waitForExtensionsLock(runExtensions);
  return waiting.firstAttempt;
}

function runExtensions(lock: ExtensionsLock) {
  waiting = null;
  const scheduler = startScheduler({ dispatch: dispatchTimer });
  const maintenance = startMaintenance();
  rebuildBindingsInBackground();
  const current = {
    lock,
    stop() {
      scheduler.stop();
      maintenance.stop();
    },
  };
  running = current;
  void lock.lost.then(async () => {
    if (running !== current) return;
    running = null;
    current.stop();
    console.error('[extensions] another process took the extensions lock over; extensions are off here until it lets go');
    await closeExtensionHost().catch((error) => console.error('[extensions] closing extension instances failed:', error instanceof Error ? error.message : error));
    if (!shuttingDown) void waitForLock();
  });
}

/** Stop timers and maintenance, close live instances, and only then give the lock up. */
async function stopExtensions() {
  shuttingDown = true;
  waiting?.stop();
  const current = running;
  if (!current) return;
  current.stop();
  try {
    await closeExtensionHost();
  } catch (error) {
    console.error('[extensions] closing extension instances failed:', error instanceof Error ? error.message : error);
  } finally {
    current.lock.release();
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  // Extension panel frames are served to a sandboxed document that must never
  // see the session, so their requests don't read the cookie at all.
  if (isFramePath(event.url.pathname)) {
    event.locals.user = null;
    return resolve(event);
  }
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
