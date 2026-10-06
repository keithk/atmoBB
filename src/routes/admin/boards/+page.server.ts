import { fail } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
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
import { createForumRecord, createForumRecordAsGiven, deleteForumRecord, getForumRecord, putForumRecord } from '$lib/server/forum-repo';
import { withBoardWrite } from '$lib/server/board-write-lock';
import { savedRedirect } from '$lib/server/saved-redirect';
import { parseAtUri } from '$lib/appview-paths';
import { boardOrderPeers, parseBoardColor, parseBoardEmoji, withBoardColor } from '$lib/board-presentation';

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
  const p = parseAtUri(uri);
  if (!p || p.did !== FORUM_DID() || p.collection !== `${NS}.forum.board`) return null;
  const board = await getForumRecord(p.collection, p.rkey);
  return board ? { ...board, value: board.value as BoardIndex['boards'][number]['value'] } : null;
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
    const parsedEmoji = parseBoardEmoji(form.get('emoji'));
    if (!parsedEmoji.valid) return fail(400, { message: 'Choose one emoji, or leave it blank for no icon.' });
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
      ...(parsedEmoji.emoji ? { emoji: parsedEmoji.emoji } : {}),
      description: optional(form.get('description')),
      category,
      parent,
      order: maxOrder + 1,
      createdAt: new Date().toISOString(),
    }, parsedColor.color);
    let created: { uri: string };
    const wantPrivate = form.get('private') === 'on';
    if (wantPrivate) {
      const rkey = randomUUID();
      let space: string;
      try {
        space = await createSpace(rkey, { displayName: name });
      } catch (e) {
        return fail(502, {
          message: `No board was published. Private space creation could not be confirmed for board key ${rkey}. Check the space inventory before retrying: ${e instanceof Error ? e.message : 'space error'}.`,
        });
      }
      try {
        created = await createForumRecordAsGiven(`${NS}.forum.board`, {
          $type: `${NS}.forum.board`,
          ...value,
          access: { $type: SPACE_ACCESS, space },
        }, rkey);
      } catch (e) {
        // A timeout may mean the private record was committed. Keep its space.
        return fail(502, {
          message: `Creation of "${name}" could not be confirmed. Its private space ${space} was retained. Check board key ${rkey} in the forum repository before retrying; do not delete the space while a board may use it: ${e instanceof Error ? e.message : 'record error'}.`,
        });
      }
    } else {
      try {
        created = await createForumRecord(`${NS}.forum.board`, value);
      } catch (e) {
        return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t create the board. Try again.' });
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
    return withBoardWrite(uri, async () => {
      const p = parseAtUri(uri);
      const board = p ? await currentBoard(uri) : undefined;
      if (!p || !board) return fail(404, { message: 'Board not found.' });
      const name = String(form.get('name') ?? '').trim();
      if (!name) return fail(400, { message: 'Enter a name for the board.' });
      const parsedColor = parseBoardColor(form.get('color'));
      if (!parsedColor.valid) return fail(400, { message: 'Board color must be a full hex color such as #1a73e8.' });
      const parsedEmoji = parseBoardEmoji(form.get('emoji'));
      if (!parsedEmoji.valid) return fail(400, { message: 'Choose one emoji, or leave it blank for no icon.' });
      const record = withBoardColor({
        ...board.value,
        name,
        emoji: parsedEmoji.emoji,
        description: optional(form.get('description')),
        category: optional(form.get('category')),
      }, parsedColor.color);
      if (!record.description) delete record.description;
      if (!record.category) delete record.category;
      if (!record.emoji) delete record.emoji;

      // Privacy toggle: create the space on public→private, or (with an explicit
      // confirm) tear it down on private→public — deleting a space cascades to
      // every thread and reply inside it.
      // Posting rejects mismatches between authoritative access and owned spaces.
      // Keep spaces on uncertain writes rather than risking private content.
      const currentSpace = spaceOfBoard(board.value.access);
      const wantPrivate = form.get('private') === 'on';
      let spaceToDelete: string | null = null;
      if (wantPrivate && !currentSpace) {
        if (!privateBoardsEnabled()) {
          return fail(400, { message: 'Members-only boards aren\'t available on this deployment.' });
        }
        try {
          const space = await createSpace(p.rkey, { displayName: name });
          record.access = { $type: SPACE_ACCESS, space };
        } catch (e) {
          return fail(502, { message: `Private space creation could not be confirmed. The board record was not changed. Check its space inventory before retrying; posting stays blocked if access and spaces disagree: ${e instanceof Error ? e.message : 'space error'}.` });
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
        return fail(502, { message: `The board write could not be confirmed. No private space was deleted. Check the authoritative board record and its space before retrying; posting stays blocked if they disagree: ${e instanceof Error ? e.message : 'record error'}.` });
      }
      if (spaceToDelete) {
        try {
          await deleteSpace(spaceToDelete);
        } catch (e) {
          // Restore private access even when deletion's outcome is uncertain.
          // A missing space then blocks posting rather than falling back to public.
          const restored = await putForumRecord(`${NS}.forum.board`, p.rkey, {
            ...record,
            access: { $type: SPACE_ACCESS, space: spaceToDelete },
          }).then(() => true, () => false);
          return fail(502, {
            message: restored
              ? `Private space deletion could not be confirmed. "${name}" was restored to members-only. Check its space before retrying; posting stays blocked if the space is missing: ${e instanceof Error ? e.message : 'space error'}.`
              : `Neither private space deletion nor restoration of "${name}" could be confirmed. Check the authoritative board record and space inventory before retrying. Posting stays blocked while they disagree: ${e instanceof Error ? e.message : 'space error'}.`,
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
          (b.value.emoji ?? undefined) === record.emoji &&
          spaceOfBoard(b.value.access) === spaceOfBoard(record.access)
        );
      });
    });
  },

  deleteBoard: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    return withBoardWrite(uri, async () => {
      const board = await currentBoard(uri);
      if (!board) return fail(404, { message: 'Board not found.' });
      const space = spaceOfBoard(board.value.access);
      const threadCount = (await readIndex()).boards.find((b) => b.uri === uri)?.threadCount ?? 0;
      if ((space || threadCount > 0) && form.get('really') !== 'on') {
        return fail(400, {
          message: space
            ? `Deleting "${board.value.name}" deletes its private space and every thread and reply inside it. Check the confirmation box to continue.`
            : `"${board.value.name}" has ${threadCount} threads. Check the confirmation box to delete the board. Its threads will remain in their authors' accounts but will no longer have a board.`,
        });
      }
      try {
        await deleteForumRecord(uri);
      } catch (e) {
        return fail(502, { message: `Board deletion could not be confirmed. No private space was deleted. Check the board record before retrying: ${e instanceof Error ? e.message : 'record error'}.` });
      }
      if (space) {
        try {
          await deleteSpace(space);
        } catch (e) {
          const p = parseAtUri(uri)!;
          const restored = await putForumRecord(p.collection, p.rkey, board.value).then(() => true, () => false);
          return fail(502, {
            message: `Private space deletion could not be confirmed. ${restored ? 'The members-only board record was restored.' : 'The members-only board record could not be restored.'} Check the authoritative board record and space inventory before retrying; posting stays blocked if they disagree: ${e instanceof Error ? e.message : 'space error'}.`,
          });
        }
      }
      await saveRedirect((i) => !i.boards.some((b) => b.uri === uri));
    });
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
        await withBoardWrite(row.uri, async () => {
          const board = await currentBoard(row.uri);
          if (!board) throw new Error('Board not found.');
          const p = parseAtUri(row.uri)!;
          await putForumRecord(`${NS}.forum.board`, p.rkey, { ...board.value, order });
        });
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
