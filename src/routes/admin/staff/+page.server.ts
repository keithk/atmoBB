import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminActor, forumStaff, invalidateStaff, resolveDid } from '$lib/server/admin';
import { getBoardIndex, getStaff, FORUM_DID } from '$lib/server/appview';
import { createForumRecord, deleteForumRecord } from '$lib/server/forum-repo';
import { savedRedirect } from '$lib/server/saved-redirect';

const NS = 'app.atmobb';

// Staff data itself comes from the admin layout load; boards feed the scope
// picker and name the boards a scoped grant covers.
export const load: PageServerLoad = async () => {
  const index = await getBoardIndex(FORUM_DID());
  return {
    boards: index.boards.map((b) => ({ uri: b.uri, name: b.value.name, parent: b.value.parent })),
  };
};

export const actions: Actions = {
  add: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const handle = String(form.get('handle') ?? '').trim();
    const role = String(form.get('role') ?? 'moderator');
    const boards = form.getAll('boards').map(String).filter(Boolean);
    if (!handle) return fail(400, { message: 'Enter a handle.' });
    if (role !== 'admin' && role !== 'moderator') return fail(400, { message: 'Choose a valid staff role.' });
    if (role === 'admin' && boards.length) {
      return fail(400, { message: 'Admins always cover the whole forum. Make them a moderator to limit them to boards.' });
    }
    const known = new Set((await getBoardIndex(FORUM_DID())).boards.map((b) => b.uri));
    if (boards.some((b) => !known.has(b))) return fail(400, { message: 'Choose boards from this forum.' });

    const did = await resolveDid(handle);
    if (!did) return fail(400, { message: `We couldn't find @${handle.replace(/^@/, '')}.` });
    const staff = await forumStaff();
    if (staff.some((s) => s.subject === did)) {
      return fail(400, { message: 'This person is already on staff. Remove their current role before assigning a new one.' });
    }

    try {
      await createForumRecord(`${NS}.forum.moderator`, {
        subject: did,
        role,
        ...(boards.length ? { boards } : {}),
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t add this person to the staff. Try again.' });
    }
    // Poll the appview directly (forumStaff caches for a minute), then drop
    // the cache so the layout's staff list refetches on landing.
    invalidateStaff();
    await savedRedirect(
      '/admin/staff?saved=1',
      () => getStaff(FORUM_DID()),
      (res) => res.staff.some((s) => s.subject === did && s.role === role),
    );
  },

  remove: async ({ request, locals }) => {
    const actor = await adminActor(locals);
    if (!actor) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const staff = await forumStaff();
    const target = staff.find((s) => s.uri === uri);
    if (!target) return fail(404, { message: 'Staff role not found.' });

    // Don't let the last admin remove themselves — that locks the panel.
    const admins = staff.filter((s) => s.role === 'admin');
    if (target.subject === actor && target.role === 'admin' && admins.length === 1) {
      return fail(400, { message: "You're the only admin. Add another admin before removing yourself." });
    }

    try {
      await deleteForumRecord(uri);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t remove this staff member. Try again.' });
    }
    invalidateStaff();
    await savedRedirect(
      '/admin/staff?saved=1',
      () => getStaff(FORUM_DID()),
      (res) => !res.staff.some((s) => s.uri === uri),
    );
  },
};
