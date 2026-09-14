import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminActor } from '$lib/server/admin';
import { triggerUpdate, updateStatus, updatesEnabled } from '$lib/server/updates';

export const load: PageServerLoad = async () => {
  if (!updatesEnabled()) return { currentVersion: __ATMOBB_VERSION__, enabled: false, status: null };
  try {
    return { currentVersion: __ATMOBB_VERSION__, enabled: true, status: await updateStatus() };
  } catch (error) {
    return {
      currentVersion: __ATMOBB_VERSION__,
      enabled: true,
      status: null,
      statusError: error instanceof Error ? error.message : 'The host updater is unavailable.',
    };
  }
};

export const actions: Actions = {
  stable: async ({ locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can update this forum.' });
    try {
      await triggerUpdate('stable');
      return { queued: 'stable' };
    } catch (error) {
      return fail(502, { message: error instanceof Error ? error.message : 'The update could not be started.' });
    }
  },
  main: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can update this forum.' });
    const form = await request.formData();
    if (String(form.get('confirmation') ?? '') !== 'main') {
      return fail(400, { message: 'Type main exactly to confirm this dangerous update.' });
    }
    try {
      await triggerUpdate('main');
      return { queued: 'main' };
    } catch (error) {
      return fail(502, { message: error instanceof Error ? error.message : 'The update could not be started.' });
    }
  },
};
