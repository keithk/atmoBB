import { error, fail, redirect, type Cookies } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminActor } from '$lib/server/admin';
import { createUpdaterSession, triggerMaintenance, triggerUpdate, updateStatus, updatesEnabled } from '$lib/server/updates';

export const load: PageServerLoad = async ({ locals }) => {
  if (!(await adminActor(locals))) error(403, 'Only admins can access updates.');
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

async function openConsole(cookies: Cookies, start?: () => Promise<unknown>) {
  try {
    // Establish recovery access before an operation can take the app offline.
    // The long-lived host bearer never leaves the server.
    const session = await createUpdaterSession();
    cookies.set('atmobb_updater', session.token, {
      path: '/_atmobb', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 43200,
    });
    await start?.();
  } catch (error) {
    return fail(502, { message: error instanceof Error ? error.message : 'The host updater is unavailable.' });
  }
  redirect(303, '/_atmobb/');
}

export const actions: Actions = {
  stable: async ({ locals, cookies }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can update this forum.' });
    return openConsole(cookies, () => triggerUpdate('stable'));
  },
  main: async ({ request, locals, cookies }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can update this forum.' });
    const form = await request.formData();
    if (String(form.get('confirmation') ?? '') !== 'main') {
      return fail(400, { message: 'Type main exactly to confirm this dangerous update.' });
    }
    return openConsole(cookies, () => triggerUpdate('main'));
  },
  maintenance: async ({ locals, cookies }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can manage maintenance.' });
    return openConsole(cookies, () => triggerMaintenance('on'));
  },
  console: async ({ locals, cookies }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can access the updater.' });
    return openConsole(cookies);
  },
};
