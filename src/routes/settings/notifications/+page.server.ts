import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { FORUM_DID, getBoardIndex } from '$lib/server/appview';
import { boardPath } from '$lib/appview-paths';
import { getWatches, unwatchBoard, watchFailureMessage } from '$lib/server/pds';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, '/login');
  const [watches, index] = await Promise.all([getWatches(locals.user.did, FORUM_DID()), getBoardIndex(FORUM_DID())]);
  const names = new Map(index.boards.map((b) => [b.uri, b.value.name]));
  return {
    did: locals.user.did,
    // A watch of a board this forum no longer lists still shows, by its rkey,
    // so the member can drop it.
    watches: watches.map((w) => ({
      board: w.board,
      name: names.get(w.board) ?? w.board.split('/').pop() ?? w.board,
      href: boardPath(w.board, FORUM_DID()),
    })),
  };
};

export const actions: Actions = {
  unwatch: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to change your watches.' });
    const board = String((await request.formData()).get('board') ?? '');
    if (!board.startsWith('at://')) return fail(400, { message: 'Board information is missing.' });
    try {
      await unwatchBoard(locals.user.did, FORUM_DID(), board);
    } catch (e) {
      return fail(502, { message: watchFailureMessage(e) });
    }
  },
};
