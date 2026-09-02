import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { forumConnected, forumStaff, isAdmin } from '$lib/server/admin';
import { forumWriteMode } from '$lib/server/forum-repo';
import { resolveHandle } from '$lib/server/appview';
import { hostingEnabled } from '$lib/server/hosting';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) redirect(303, '/login');
  const [admin, staff, connected] = await Promise.all([
    isAdmin(locals.user.did),
    forumStaff(),
    forumConnected(),
  ]);
  // Bootstrap: with no staff at all, any logged-in user may reach the connect
  // screen — completing it requires the forum account's own credentials.
  if (!admin && staff.length > 0) error(403, 'Only admins can access this page.');
  if (!admin && url.pathname !== '/admin/connect') redirect(303, '/admin/connect');

  const staffHandles = Object.fromEntries(
    await Promise.all(staff.map(async (s) => [s.subject, await resolveHandle(s.subject)] as const)),
  );

  return {
    staff,
    staffHandles,
    connected,
    writeMode: forumWriteMode(),
    hostingEnabled: hostingEnabled(),
  };
};
