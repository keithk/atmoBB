import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminActor } from '$lib/server/admin';
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

export const load: PageServerLoad = async () => {
  if (!hostingEnabled()) error(404, 'Not found');
  await checkProvisioning();
  const [invites, requests] = await Promise.all([listInvites(), listRequests()]);
  return { invites, requests, suffix: hostingDomainSuffix() };
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
    await rejectRequest(String(form.get('id') ?? ''));
    return { rejected: true };
  },

  invite: async ({ request, locals }) => {
    if (!hostingEnabled()) error(404, 'Not found');
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const invite = await createInvite(String(form.get('note') ?? '').trim());
    return { invited: invite.code };
  },
};
