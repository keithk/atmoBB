import { fail } from '@sveltejs/kit';
import type { ExtensionManifest } from '$lib/extensions/contract';
import { adminActor } from '$lib/server/admin';
import { FORUM_DID } from '$lib/server/appview';
import { forumScopeStatus } from '$lib/server/atproto-oauth';
import { releaseClaim } from '$lib/server/extensions/claims';
import { endorsementFor } from '$lib/server/extensions/endorsement';
import { openWork } from '$lib/server/extensions/host';
import { extensionsLockHeld } from '$lib/server/extensions/lock';
import { extensionsEnabled } from '$lib/server/extensions/manifest';
import { listInstalls, type InstallReview, type StopOptions } from '$lib/server/extensions/registry';
import { extensionScope, refreshExtensionScopes } from '$lib/server/extensions/scopes';
import { forumWriteMode } from '$lib/server/forum-repo';

// What the extensions list and an install's page share: who may change
// extensions, whether this server may, what an admin reviews before a release
// goes live, and whether the forum account needs reconnecting afterwards.

/** Why this server can't change extensions right now, or null when it can. */
export function unavailableReason(): string | null {
  if (!extensionsEnabled()) {
    return 'Extensions are turned off on this forum (ATMOBB_EXTENSIONS=off), so none of them run and nothing here can be changed. Remove that setting and restart the forum to turn them back on.';
  }
  if (!extensionsLockHeld()) {
    return "Another copy of this forum's server is running extensions right now, which usually means an update is rolling out. Changes are paused on this copy; reload in a minute or two.";
  }
  return null;
}

/** The refusal for a form action the user or this server can't carry out, or null to go ahead. */
export async function refuseAction(locals: App.Locals) {
  if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
  const reason = unavailableReason();
  return reason ? fail(503, { message: reason }) : null;
}

export type ReconnectStatus = { needed: false } | { needed: true; missing: string[]; notConnected: boolean };

/** Whether the forum account's login lacks scopes the active extensions need. */
export async function reconnectStatus(): Promise<ReconnectStatus> {
  // Development mode writes straight to the local index, with no login to widen.
  if (forumWriteMode() === 'index') return { needed: false };
  try {
    const status = await forumScopeStatus(FORUM_DID());
    return status.ok ? { needed: false } : { needed: true, missing: status.missing, notConnected: false };
  } catch {
    const missing = extensionScope().split(' ').filter(Boolean);
    return missing.length ? { needed: true, missing, notConnected: true } : { needed: false };
  }
}

/** After a change to which installs are active or what they declare: re-read the scopes they need and check the login covers them. */
export async function refreshScopes(): Promise<ReconnectStatus> {
  await refreshExtensionScopes();
  return reconnectStatus();
}

/** Disable and uninstall go ahead only when the extension reports no work in progress, unless the admin forces it. */
export function stopOptions(form: FormData): StopOptions {
  return {
    force: form.get('force') === 'on',
    // An extension that can't answer might be mid-game; treat that as open work.
    hasOpenWork: (install) => openWork(install.id).catch(() => true),
  };
}

/** What the atmobb.app directory says about a release. */
export interface EndorsementStatus {
  /** The directory endorses the repository. */
  repositoryEndorsed: boolean;
  /** The directory reviewed this exact commit. */
  shaReviewed: boolean;
}

/** What the atmobb.app directory says about a release, for reviewView's endorsement slot. Never null on a lookup failure — that reads as unendorsed. */
export async function endorsementStatus(gitUrl: string, sha: string): Promise<EndorsementStatus | null> {
  const lookup = await endorsementFor(gitUrl, sha);
  return lookup.status === 'endorsed' ? { repositoryEndorsed: true, shaReviewed: lookup.reviewed } : null;
}

export interface ManifestChanges {
  version: { from: string; to: string };
  addedCollections: string[];
  removedCollections: string[];
  addedCapabilities: string[];
  removedCapabilities: string[];
  hostApi: { from: string; to: string } | null;
  dataVersion: { from: number; to: number } | null;
}

export function manifestChanges(from: ExtensionManifest, to: ExtensionManifest): ManifestChanges {
  const added = (a: string[], b: string[]) => b.filter((item) => !a.includes(item));
  return {
    version: { from: from.version, to: to.version },
    addedCollections: added(from.collections, to.collections),
    removedCollections: added(to.collections, from.collections),
    addedCapabilities: added(from.capabilities, to.capabilities),
    removedCapabilities: added(to.capabilities, from.capabilities),
    hostApi: from.hostApi === to.hostApi ? null : { from: from.hostApi, to: to.hostApi },
    dataVersion: from.dataVersion === to.dataVersion ? null : { from: from.dataVersion, to: to.dataVersion },
  };
}

/**
 * What the admin reviews before confirming a staged release. `current` is the
 * manifest an update would replace. Without an endorsement the release is an
 * unverified extension, which can still be installed.
 */
export function reviewView(review: InstallReview, current: ExtensionManifest | null = null, endorsement: EndorsementStatus | null = null) {
  const { manifest } = review;
  return {
    stagingId: review.stagingId,
    installId: review.installId,
    gitUrl: review.gitUrl,
    source: review.source,
    tag: review.tag,
    sha: review.sha,
    name: manifest.name,
    version: manifest.version,
    hostApi: manifest.hostApi,
    dataVersion: manifest.dataVersion,
    authority: review.authority,
    collections: review.collections,
    capabilities: manifest.capabilities,
    lexicons: review.published,
    endorsement,
    unverified: !endorsement?.repositoryEndorsed,
    changes: current ? manifestChanges(current, manifest) : null,
    restoresData: review.restoresData,
  };
}

export type ReviewView = ReturnType<typeof reviewView>;

/** Release a collection claim from a confirmed form, unless an installed extension still declares the collection. */
export async function releaseClaimFromForm(form: FormData) {
  const collection = String(form.get('collection') ?? '');
  if (form.get('really') !== 'on') {
    return fail(400, { message: `Check the confirmation box to release ${collection}. Any extension could then claim it.` });
  }
  const declaring = (await listInstalls()).find((install) => install.manifest.collections.includes(collection));
  if (declaring) {
    return fail(409, {
      message: `${declaring.manifest.name} still writes ${collection}. Uninstall it, or update it to a release that no longer uses that collection, before releasing the claim.`,
    });
  }
  if (!(await releaseClaim(collection))) return fail(404, { message: `No extension holds ${collection}.` });
  return { released: collection };
}
