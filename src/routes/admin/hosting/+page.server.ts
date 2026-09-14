import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminActor } from '$lib/server/admin';
import { fleetEnabled, fleetStatus, setHostingLimit, updateHostedInstance } from '$lib/server/hosting-host';
import {
  approveRequest,
  checkProvisioning,
  createInvite,
  hostingEnabled,
  hostingDomainSuffix,
  listInvites,
  listRequests,
  rejectRequest,
} from '$lib/server/hosting';

export const load: PageServerLoad = async ({ locals }) => {
  if (!(await adminActor(locals))) error(403, 'Only admins can view hosting requests.');
  if (!hostingEnabled()) error(404, 'Not found');
  let fleetError: string | undefined;
  try { await checkProvisioning(); }
  catch (err) { fleetError = err instanceof Error ? err.message : 'Hosting service unavailable.'; }
  const [invites, requests] = await Promise.all([listInvites(), listRequests()]);
  if (!fleetEnabled()) {
    return { invites, requests, suffix: hostingDomainSuffix(), fleet: null };
  }
  try {
    if (fleetError) throw new Error(fleetError);
    return { invites, requests, suffix: hostingDomainSuffix(), fleet: await fleetStatus() };
  } catch (err) {
    return {
      invites,
      requests,
      suffix: hostingDomainSuffix(),
      fleet: null,
      fleetError: err instanceof Error ? err.message : 'The isolated hosting service is unavailable.',
    };
  }
};

export const actions: Actions = {
  approve: async ({ request, locals }) => {
    if (!hostingEnabled()) error(404, 'Not found');
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const r = await approveRequest(String(form.get('id') ?? ''));
    if (!r) return fail(404, { message: 'Request not found.' });
    if (r.status === 'failed') {
      return fail(502, { message: `Provisioning failed: ${r.error ?? 'unknown error'}. Approve again to retry.` });
    }
    return { approved: true };
  },

  reject: async ({ request, locals }) => {
    if (!hostingEnabled()) error(404, 'Not found');
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    try {
      await rejectRequest(String(form.get('id') ?? ''));
      return { rejected: true };
    } catch (err) {
      return fail(409, { message: err instanceof Error ? err.message : 'Request could not be rejected.' });
    }
  },

  invite: async ({ request, locals }) => {
    if (!hostingEnabled()) error(404, 'Not found');
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const invite = await createInvite(String(form.get('note') ?? '').trim());
    return { invited: invite.code };
  },

  capacity: async ({ request, locals }) => {
    if (!hostingEnabled() || !fleetEnabled()) error(404, 'Not found');
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const raw = String(form.get('limit') ?? '');
    const limit = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(limit) || limit < 0 || limit > 1000) {
      return fail(400, { message: 'Capacity must be a whole number from 0 to 1000.' });
    }
    try {
      return { capacityUpdated: true, fleet: await setHostingLimit(limit) };
    } catch (err) {
      return fail(502, { message: err instanceof Error ? err.message : 'Capacity could not be changed.' });
    }
  },

  update: async ({ request, locals }) => {
    if (!hostingEnabled() || !fleetEnabled()) error(404, 'Not found');
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const target = String(form.get('target') ?? '');
    if (!id) return fail(400, { message: 'Hosted instance id is required.' });
    if (target !== 'stable' && target !== 'main') return fail(400, { message: 'Invalid update target.' });
    if (target === 'main' && String(form.get('confirmation') ?? '') !== 'main') {
      return fail(400, { message: 'Type main exactly to confirm this dangerous update.' });
    }
    try {
      await updateHostedInstance(id, target);
      return { updateQueued: id };
    } catch (err) {
      return fail(502, { message: err instanceof Error ? err.message : 'The instance update could not be started.' });
    }
  },
};
