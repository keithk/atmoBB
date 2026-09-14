import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminActor } from '$lib/server/admin';
import { listClaims } from '$lib/server/extensions/claims';
import { extensionLog, migrate, openWork } from '$lib/server/extensions/host';
import {
  applyUpdate,
  disableInstall,
  discardStaged,
  enableInstall,
  getInstall,
  listUpdates,
  rollbackInstall,
  stageUpdate,
  uninstall,
} from '$lib/server/extensions/registry';
import {
  endorsementStatus,
  reconnectStatus,
  refreshScopes,
  refuseAction,
  releaseClaimFromForm,
  reviewView,
  stopOptions,
  unavailableReason,
} from '../extensions.server';

async function installOr404(id: string) {
  const install = await getInstall(id);
  if (!install) error(404, 'That extension isn’t installed.');
  return install;
}

type OpenWorkCheck = { busy: boolean } | { error: string };

async function checkOpenWork(installId: string): Promise<OpenWorkCheck> {
  try {
    return { busy: await openWork(installId) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!(await adminActor(locals))) error(403, 'Only admins can manage extensions.');
  const install = await installOr404(params.install);
  const unavailable = unavailableReason();
  const { manifest } = install;
  const [updates, openWorkCheck, claims, reconnect] = await Promise.all([
    listUpdates(install.id),
    // Asking the extension needs it running, which this server can't do while extensions are unavailable.
    unavailable ? null : checkOpenWork(install.id),
    listClaims(),
    reconnectStatus(),
  ]);
  return {
    unavailable,
    install: {
      id: install.id,
      name: manifest.name,
      version: manifest.version,
      tag: install.tag,
      sha: install.sha,
      source: install.source,
      state: install.state,
      gitUrl: install.gitUrl,
      collections: manifest.collections,
      capabilities: manifest.capabilities,
      hostApi: manifest.hostApi,
      dataVersion: manifest.dataVersion,
      installedAt: install.installedAt,
      updatedAt: install.updatedAt,
    },
    history: install.history
      .filter((release) => release.sha !== install.sha)
      .reverse()
      .map((release) => ({ ...release, canRollBack: release.dataVersion === manifest.dataVersion })),
    updates: updates.ok ? { newer: updates.newer, changed: updates.changed } : { error: updates.errors.map((e) => e.message).join(' ') },
    openWork: openWorkCheck,
    log: extensionLog(install.id),
    claims: Object.entries(claims)
      .filter(([, claim]) => claim.gitUrl === install.normalizedUrl)
      .map(([collection, claim]) => ({ collection, claimedAt: claim.claimedAt, declared: manifest.collections.includes(collection) })),
    reconnect,
  };
};

export const actions: Actions = {
  stageUpdate: async ({ request, locals, params }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    const install = await installOr404(params.install);
    const form = await request.formData();
    const tag = String(form.get('tag') ?? '').trim() || null;
    if (!tag && install.source !== 'dev') return fail(400, { errors: [{ field: 'tag', message: 'Pick a release to update to.' }] });
    const result = await stageUpdate(install.id, tag);
    if (!result.ok) return fail(400, { errors: result.errors });
    const endorsement = await endorsementStatus(result.review.gitUrl, result.review.sha);
    return { review: reviewView(result.review, install.manifest, endorsement) };
  },

  applyUpdate: async ({ request, locals, params }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    const install = await installOr404(params.install);
    const form = await request.formData();
    const result = await applyUpdate(install.id, String(form.get('stagingId') ?? ''), { migrate });
    if (!result.ok) return fail(400, { errors: result.errors });
    const { manifest, tag } = result.install;
    return { updated: { version: manifest.version, tag }, reconnect: await refreshScopes() };
  },

  discardUpdate: async ({ request, locals, params }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    await installOr404(params.install);
    const form = await request.formData();
    await discardStaged(String(form.get('stagingId') ?? ''));
    return { discarded: true };
  },

  rollback: async ({ request, locals, params }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    const install = await installOr404(params.install);
    const form = await request.formData();
    const result = await rollbackInstall(install.id, String(form.get('sha') ?? ''));
    if (!result.ok) return fail(400, { errors: result.errors });
    const { manifest, tag } = result.install;
    return { rolledBack: { version: manifest.version, tag }, reconnect: await refreshScopes() };
  },

  disable: async ({ request, locals, params }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    const install = await installOr404(params.install);
    const result = await disableInstall(install.id, stopOptions(await request.formData()));
    if (!result.ok) return fail(409, { errors: result.errors, openWork: result.errors.some((e) => e.field === 'openWork') });
    await refreshScopes();
    return { disabled: true };
  },

  enable: async ({ locals, params }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    const install = await installOr404(params.install);
    const result = await enableInstall(install.id);
    if (!result.ok) return fail(400, { errors: result.errors });
    return { enabled: true, reconnect: await refreshScopes() };
  },

  uninstall: async ({ request, locals, params }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    const install = await installOr404(params.install);
    const result = await uninstall(install.id, stopOptions(await request.formData()));
    if (!result.ok) return fail(409, { errors: result.errors, openWork: result.errors.some((e) => e.field === 'openWork') });
    await refreshScopes();
    redirect(303, `/admin/extensions?uninstalled=${encodeURIComponent(install.manifest.name)}`);
  },

  releaseClaim: async ({ request, locals, params }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    await installOr404(params.install);
    return releaseClaimFromForm(await request.formData());
  },
};
