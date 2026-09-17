import { purgeUninstalledKv } from './kv';
import { forgetUninstalled, listUninstalled } from './registry';
import { purgeInstallTimers } from './scheduler';

// Housekeeping for the process holding the extensions lock: once an
// uninstalled install's grace period ends, its k/v store and pending timers
// go, and the registry stops tracking it.

const DAY_MS = 24 * 60 * 60_000;

/** Purge private data for installs uninstalled longer than the grace period. Returns their ids. */
export async function purgeUninstalled(now = Date.now()): Promise<string[]> {
  const purged = await purgeUninstalledKv(await listUninstalled(), now);
  for (const installId of purged) await purgeInstallTimers(installId);
  if (purged.length) await forgetUninstalled(purged);
  return purged;
}

/** Run the purge now and then about daily, unref'd so it never keeps the process alive. */
export function startMaintenance(intervalMs = DAY_MS): { stop(): void } {
  const run = () =>
    void purgeUninstalled().catch((error) => console.error('[extensions] purging uninstalled extension data failed:', error instanceof Error ? error.message : error));
  run();
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
  return { stop: () => clearInterval(interval) };
}
