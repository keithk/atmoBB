import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  getBoardIndex,
  FORUM_DID,
  createSpace,
  deleteSpace,
  spaceOfBoard,
} from '$lib/server/appview';
import type { BoardIndex } from '$lib/server/appview';
import { adminActor } from '$lib/server/admin';
import { privateBoardsEnabled } from '$lib/server/happyview-session';
import { createForumRecord, deleteForumRecord, putForumRecord } from '$lib/server/forum-repo';
import { savedRedirect } from '$lib/server/saved-redirect';
import { parseAtUri } from '$lib/appview-paths';
import { boardOrderPeers, parseBoardColor, withBoardColor } from '$lib/board-presentation';

const NS = 'app.atmobb';
const SPACE_ACCESS = `${NS}.forum.board#space`;

// Access requests and each private board's readers live on /admin/members.
export const load: PageServerLoad = async () => {
  const index = await getBoardIndex(FORUM_DID());
  return {
    boards: index.boards,
    categories: index.categories ?? [],
    privateBoardsEnabled: privateBoardsEnabled(),
  };
};

async function currentBoard(uri: string) {
  const index = await getBoardIndex(FORUM_DID());
  return index.boards.find((b) => b.uri === uri);
}

const optional = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

const readIndex = () => getBoardIndex(FORUM_DID());

// Hold the post-save redirect until the appview has indexed the write. Moves
// pass saved=false: the reordered list is its own feedback.
const saveRedirect = (landed: (index: BoardIndex) => boolean, saved = true) =>
  savedRedirect(saved ? '/admin/boards?saved=1' : '/admin/boards', readIndex, landed);

// Swap a row with its neighbor in the appview's display order, then renumber
// the whole list 0..n so every row has a distinct order (older data may carry
// duplicates). Returns only the rows whose stored order changed, null if the
// uri isn't in the list, and [] for a no-op move past either end.
function reordered<T extends { uri: string; value: { order?: number } }>(
  list: T[],
  uri: string,
  dir: 'up' | 'down',
): { row: T; order: number }[] | null {
  const rows = [...list];
  const at = rows.findIndex((r) => r.uri === uri);
  if (at < 0) return null;
  const to = at + (dir === 'up' ? -1 : 1);
  if (to < 0 || to >= rows.length) return [];
  [rows[at], rows[to]] = [rows[to], rows[at]];
  return rows
    .map((row, order) => ({ row, order }))
    .filter(({ row, order }) => row.value.order !== order);
}

export const actions: Actions = {
  createBoard: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    if (!name) return fail(400, { message: 'Enter a name for the board.' });
    const parsedColor = parseBoardColor(form.get('color'));
    if (!parsedColor.valid) return fail(400, { message: 'Board color must be a full hex color such as #1a73e8.' });
    if (form.get('private') === 'on' && !privateBoardsEnabled()) {
      return fail(400, { message: 'Members-only boards aren\'t available on this deployment.' });
    }
    const index = await getBoardIndex(FORUM_DID());
    const parent = optional(form.get('parent'));
    const category = optional(form.get('category'));
    const peers = parent
      ? index.boards.filter((board) => board.value.parent === parent)
      : index.boards.filter(
          (board) => !board.value.parent && board.value.category === category,
        );
    const maxOrder = Math.max(-1, ...peers.map((b) => b.value.order ?? -1));
    const value = withBoardColor<Record<string, unknown>>({
      name,
      description: optional(form.get('description')),
      category,
      parent,
      order: maxOrder + 1,
      createdAt: new Date().toISOString(),
    }, parsedColor.color);
    let created: { uri: string };
    try {
      created = await createForumRecord(`${NS}.forum.board`, value);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t create the board. Try again.' });
    }
    // Members-only: back the board with a permissioned space and record the ref.
    // Reuse the value we just wrote — with PDS-first writes the new board isn't
    // in the index yet (it lands via Jetstream a few seconds later), so we can't
    // read it back here.
    const wantPrivate = form.get('private') === 'on';
    if (wantPrivate) {
      const p = parseAtUri(created.uri)!;
      let space: string;
      try {
        space = await createSpace(p.rkey, { displayName: name });
      } catch (e) {
        return fail(502, {
          message: `The board "${name}" was created, but we couldn't make it private: ${e instanceof Error ? e.message : 'space error'}. Edit the board to try again.`,
        });
      }
      try {
        await putForumRecord(`${NS}.forum.board`, p.rkey, {
          ...value,
          access: { $type: SPACE_ACCESS, space },
        });
      } catch (e) {
        // A space with no board pointing at it would still catch every new
        // thread on the board (the write path checks the space, not the
        // record) and nobody could list them. Take it down again.
        await deleteSpace(space).catch(() => {});
        return fail(502, {
          message: `The board "${name}" was created, but we couldn't make it private: ${e instanceof Error ? e.message : 'record error'}. Edit the board to try again.`,
        });
      }
    }
    await saveRedirect((i) =>
      i.boards.some((b) => b.uri === created.uri && (!wantPrivate || !!spaceOfBoard(b.value.access))),
    );
  },

  updateBoard: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const p = parseAtUri(uri);
    const board = p ? await currentBoard(uri) : undefined;
    if (!p || !board) return fail(404, { message: 'Board not found.' });
    const name = String(form.get('name') ?? '').trim();
    if (!name) return fail(400, { message: 'Enter a name for the board.' });
    const parsedColor = parseBoardColor(form.get('color'));
    if (!parsedColor.valid) return fail(400, { message: 'Board color must be a full hex color such as #1a73e8.' });
    const record = withBoardColor({
      ...board.value,
      name,
      description: optional(form.get('description')),
      category: optional(form.get('category')),
    }, parsedColor.color);
    if (!record.description) delete record.description;
    if (!record.category) delete record.category;

    // Privacy toggle: create the space on public→private, or (with an explicit
    // confirm) tear it down on private→public — deleting a space cascades to
    // every thread and reply inside it.
    // The write path decides where a thread lands by whether the space
    // exists, while readers go by the record's `access`. If those disagree,
    // a space without a record pointing at it swallows every new thread on
    // the board and nobody can list them. So the two must move together:
    // never leave a space standing behind a board whose record says public.
    const currentSpace = spaceOfBoard(board.value.access);
    const wantPrivate = form.get('private') === 'on';
    let createdSpace: string | null = null;
    let spaceToDelete: string | null = null;
    if (wantPrivate && !currentSpace) {
      if (!privateBoardsEnabled()) {
        return fail(400, { message: 'Members-only boards aren\'t available on this deployment.' });
      }
      try {
        createdSpace = await createSpace(p.rkey, { displayName: name });
        record.access = { $type: SPACE_ACCESS, space: createdSpace };
      } catch (e) {
        return fail(502, { message: `We couldn't make this board private: ${e instanceof Error ? e.message : 'space error'}` });
      }
    } else if (!wantPrivate && currentSpace) {
      if (form.get('really') !== 'on') {
        return fail(400, {
          message: `Making "${name}" public will delete its private space and every thread and reply inside it. Check the confirmation box to continue.`,
        });
      }
      delete record.access;
      spaceToDelete = currentSpace;
    }

    try {
      await putForumRecord(`${NS}.forum.board`, p.rkey, record);
    } catch (e) {
      if (createdSpace) await deleteSpace(createdSpace).catch(() => {});
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the board. Try again.' });
    }
    if (spaceToDelete) {
      try {
        await deleteSpace(spaceToDelete);
      } catch (e) {
        // Put the record back to private so the board keeps matching the
        // space that still exists. If even that fails, say so loudly.
        const restored = await putForumRecord(`${NS}.forum.board`, p.rkey, {
          ...record,
          access: { $type: SPACE_ACCESS, space: spaceToDelete },
        }).then(() => true, () => false);
        return fail(502, {
          message: restored
            ? `We couldn't delete the private space, so "${name}" is still members-only: ${e instanceof Error ? e.message : 'space error'}. Try again.`
            : `"${name}" now reads as public but its private space could not be deleted: ${e instanceof Error ? e.message : 'space error'}. New threads will be lost until this is fixed. Set the board back to members-only, then try again.`,
        });
      }
    }
    await saveRedirect((i) => {
      const b = i.boards.find((x) => x.uri === uri);
      return (
        !!b &&
        b.value.name === record.name &&
        (b.value.description ?? undefined) === record.description &&
        (b.value.category ?? undefined) === record.category &&
        (b.value.color ?? undefined) === record.color &&
        spaceOfBoard(b.value.access) === spaceOfBoard(record.access)
      );
    });
  },

  deleteBoard: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const board = await currentBoard(uri);
    if (!board) return fail(404, { message: 'Board not found.' });
    if (board.threadCount > 0 && form.get('really') !== 'on') {
      return fail(400, {
        message: `"${board.value.name}" has ${board.threadCount} threads. Check the confirmation box to delete the board. Its threads will remain in their authors' accounts but will no longer have a board.`,
      });
    }
    const space = spaceOfBoard(board.value.access);
    try {
      await deleteForumRecord(uri);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t delete the board. Try again.' });
    }
    if (space) {
      try {
        await deleteSpace(space);
      } catch {
        /* board record is gone; a leftover empty space is harmless */
      }
    }
    await saveRedirect((i) => !i.boards.some((b) => b.uri === uri));
  },

  // Move a board one step within its visible category, or among sibling
  // subforums. Those are the ordering lanes visitors see on the board index.
  moveBoard: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const dir = form.get('dir') === 'up' ? 'up' : 'down';
    const index = await readIndex();
    const peers = boardOrderPeers(index.boards, index.categories ?? [], uri);
    const writes = peers ? reordered(peers, uri, dir) : null;
    if (!writes) return fail(404, { message: 'Board not found.' });
    try {
      for (const { row, order } of writes) {
        const p = parseAtUri(row.uri)!;
        await putForumRecord(`${NS}.forum.board`, p.rkey, { ...row.value, order });
      }
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t reorder the boards. Try again.' });
    }
    await saveRedirect(
      (i) => writes.every(({ row, order }) => i.boards.find((b) => b.uri === row.uri)?.value.order === order),
      false,
    );
  },

  createCategory: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    if (!name) return fail(400, { message: 'Enter a name for the category.' });
    const index = await readIndex();
    const maxOrder = Math.max(-1, ...(index.categories ?? []).map((c) => c.value.order ?? -1));
    let created: { uri: string };
    try {
      created = await createForumRecord(`${NS}.forum.category`, { name, order: maxOrder + 1 });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t create the category. Try again.' });
    }
    await saveRedirect((i) => (i.categories ?? []).some((c) => c.uri === created.uri));
  },

  updateCategory: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const p = parseAtUri(uri);
    if (!p) return fail(404, { message: 'Category not found.' });
    const name = String(form.get('name') ?? '').trim();
    if (!name) return fail(400, { message: 'Enter a name for the category.' });
    const index = await readIndex();
    const cat = (index.categories ?? []).find((c) => c.uri === uri);
    if (!cat) return fail(404, { message: 'Category not found.' });
    try {
      await putForumRecord(`${NS}.forum.category`, p.rkey, { name, order: cat.value.order });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the category. Try again.' });
    }
    await saveRedirect((i) =>
      (i.categories ?? []).some((c) => c.uri === uri && c.value.name === name),
    );
  },

  deleteCategory: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    try {
      await deleteForumRecord(uri);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t delete the category. Try again.' });
    }
    // Boards pointing at the deleted category fall back to the plain
    // Boards section on the index; no cascade needed.
    await saveRedirect((i) => !(i.categories ?? []).some((c) => c.uri === uri));
  },

  moveCategory: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const dir = form.get('dir') === 'up' ? 'up' : 'down';
    const index = await readIndex();
    const writes = reordered(index.categories ?? [], uri, dir);
    if (!writes) return fail(404, { message: 'Category not found.' });
    try {
      for (const { row, order } of writes) {
        const p = parseAtUri(row.uri)!;
        await putForumRecord(`${NS}.forum.category`, p.rkey, { ...row.value, order });
      }
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t reorder the categories. Try again.' });
    }
    await saveRedirect(
      (i) =>
        writes.every(
          ({ row, order }) => (i.categories ?? []).find((c) => c.uri === row.uri)?.value.order === order,
        ),
      false,
    );
  },
};
