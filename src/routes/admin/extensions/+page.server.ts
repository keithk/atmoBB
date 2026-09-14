import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminActor } from '$lib/server/admin';
import { listClaims } from '$lib/server/extensions/claims';
import { ReleaseError } from '$lib/server/extensions/fetch';
import { confirmInstall, discardStaged, latestReleaseTag, listInstalls, stageInstall } from '$lib/server/extensions/registry';
import { reconnectStatus, refreshScopes, refuseAction, releaseClaimFromForm, reviewView, unavailableReason } from './extensions.server';

export const load: PageServerLoad = async ({ locals }) => {
  if (!(await adminActor(locals))) error(403, 'Only admins can manage extensions.');
  const [installs, claims] = await Promise.all([listInstalls(), listClaims()]);
  const installedRepositories = new Set(installs.map((install) => install.normalizedUrl));
  return {
    unavailable: unavailableReason(),
    installs: installs.map((install) => ({
      id: install.id,
      name: install.manifest.name,
      version: install.manifest.version,
      tag: install.tag,
      sha: install.sha,
      state: install.state,
      gitUrl: install.gitUrl,
      collections: install.manifest.collections,
      updatedAt: install.updatedAt,
    })),
    // Claims outlive an uninstall; these are the ones no installed extension's repository holds.
    leftoverClaims: Object.entries(claims)
      .filter(([, claim]) => !installedRepositories.has(claim.gitUrl))
      .map(([collection, claim]) => ({ collection, gitUrl: claim.gitUrl, claimedAt: claim.claimedAt })),
    reconnect: await reconnectStatus(),
  };
};

export const actions: Actions = {
  stage: async ({ request, locals }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    const form = await request.formData();
    const gitUrl = String(form.get('gitUrl') ?? '').trim();
    const fields = { gitUrl, tag: String(form.get('tag') ?? '').trim() };
    const problem = (field: string, message: string) => fail(400, { fields, errors: [{ field, message }] });
    if (!gitUrl) return problem('gitUrl', "Enter the git URL of the extension's repository.");

    let tag = fields.tag || null;
    if (!tag && !gitUrl.toLowerCase().startsWith('file:')) {
      try {
        tag = await latestReleaseTag(gitUrl);
      } catch (err) {
        if (err instanceof ReleaseError) return problem('gitUrl', err.message);
        throw err;
      }
      if (!tag) return problem('tag', `${gitUrl} has no release tags, like v1.0.0. Enter the tag to install.`);
    }

    const result = await stageInstall(gitUrl, tag);
    if (!result.ok) return fail(400, { fields, errors: result.errors });
    return { fields, review: reviewView(result.review) };
  },

  confirm: async ({ request, locals }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    const form = await request.formData();
    const result = await confirmInstall(String(form.get('stagingId') ?? ''));
    if (!result.ok) return fail(400, { errors: result.errors });
    const { install } = result;
    return { installed: { id: install.id, name: install.manifest.name }, reconnect: await refreshScopes() };
  },

  discard: async ({ request, locals }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    const form = await request.formData();
    await discardStaged(String(form.get('stagingId') ?? ''));
    return { discarded: true };
  },

  releaseClaim: async ({ request, locals }) => {
    const refused = await refuseAction(locals);
    if (refused) return refused;
    return releaseClaimFromForm(await request.formData());
  },
};
