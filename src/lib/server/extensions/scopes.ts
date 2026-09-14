import { env } from '$env/dynamic/private';
import { collectionScope, extensionsEnabled } from './manifest';
import { listInstalls } from './registry';

// The OAuth scopes extensions add to the forum account's login: a
// `repo:<collection>` scope for every collection an admin approved for an
// active install. A PDS only grants a scope that appears in client metadata,
// so these join both the metadata and the sysop authorize request, and the
// admin reconnects the forum account after an install or update changes them.
//
// Client metadata is built synchronously on every request while the registry
// is read from disk, so the installs' part is kept as a snapshot. Anything
// that changes which collections are approved or active refreshes it.

/** Lets the forum account publish endorsements when the forum runs the extension directory. */
export const ENDORSEMENT_SCOPE = 'repo:app.atmobb.extension.endorsement';

/** Where atmoBB records which extension staff attached to a thread, in the forum's repo. */
export const BINDING_COLLECTION = 'app.atmobb.extension.binding';
export const BINDING_SCOPE = `repo:${BINDING_COLLECTION}`;

export type ScopeStatus = { ok: true } | { ok: false; missing: string[] };

let installScope = '';
let loaded = false;
let generation = 0;

/** Re-read the registry's active installs into the scope snapshot. */
export async function refreshExtensionScopes(): Promise<void> {
  const current = ++generation;
  // With extensions off the registry isn't read, so a broken one can't block logins.
  const installs = extensionsEnabled() ? await listInstalls() : [];
  const active = installs.filter((install) => install.state === 'active');
  const collections = new Set(active.flatMap((install) => install.manifest.collections));
  if (active.length) collections.add(BINDING_COLLECTION);
  // A slower, earlier refresh must not overwrite a newer one.
  if (current !== generation) return;
  installScope = collectionScope([...collections]);
  loaded = true;
}

/** The space-separated scopes extensions add to the forum login, or '' when they add none. */
export function extensionScope(): string {
  if (!loaded) {
    loaded = true;
    refreshExtensionScopes().catch((error) => {
      loaded = false;
      console.error('Loading extension OAuth scopes failed', error);
    });
  }
  if (!extensionsEnabled()) return '';
  const directory = env.ATMOBB_EXTENSION_DIRECTORY === '1' ? ENDORSEMENT_SCOPE : '';
  return [installScope, directory].filter(Boolean).join(' ');
}

/** Whether a session's granted scope covers every scope extensions currently need. */
export function scopeStatus(granted: string): ScopeStatus {
  const grantedScopes = new Set(granted.split(' '));
  const missing = extensionScope()
    .split(' ')
    .filter((scope) => scope && !grantedScopes.has(scope));
  return missing.length ? { ok: false, missing } : { ok: true };
}
