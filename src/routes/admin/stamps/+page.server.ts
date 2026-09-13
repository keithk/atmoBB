import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBoardIndex, getStamps, FORUM_DID } from '$lib/server/appview';
import type { ForumProfile, Stamps } from '$lib/server/appview';
import { adminActor } from '$lib/server/admin';
import { createForumRecord, deleteForumRecord, listForumRecords, putForumRecord } from '$lib/server/forum-repo';
import { currentProfile, profileRedirect, saveProfile } from '$lib/server/forum-appearance';
import { savedRedirect } from '$lib/server/saved-redirect';
import { parseAtUri } from '$lib/appview-paths';
import {
  parseLook,
  parseStampForm,
  retiredByDeletedBoard,
  triggerLabel,
  type StampFormFields,
  type StampLook,
  type StoredTrigger,
} from '$lib/stamps';

const STAMP = 'app.atmobb.forum.stamp';
const HERE = '/admin/stamps';

interface StampRow {
  uri: string;
  name: string;
  look: StampLook | null;
  trigger: StoredTrigger;
  createdAt: string;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function toRow(uri: string, value: Record<string, unknown>): StampRow {
  const trigger = (value.trigger && typeof value.trigger === 'object' ? value.trigger : {}) as Record<string, unknown>;
  return {
    uri,
    name: str(value.name) ?? '',
    look: parseLook(value.look),
    trigger: {
      kind: str(trigger.kind) ?? '',
      board: str(trigger.board),
      before: str(trigger.before),
      via: str(trigger.via),
    },
    createdAt: str(value.createdAt) ?? '',
  };
}

// The appview drops a board stamp once its board is gone, so read the records
// themselves: the admin list is where a stamp retired that way gets cleaned up.
// Without repo access (forum account not connected) fall back to the appview.
async function stampRecords(): Promise<{ uri: string; value: Record<string, unknown> }[]> {
  try {
    return await listForumRecords(STAMP);
  } catch {
    const { stamps } = await getStamps(FORUM_DID());
    return stamps.map(({ uri, name, look, trigger, createdAt }) => ({ uri, value: { name, look, trigger, createdAt } }));
  }
}

async function stampRows(): Promise<StampRow[]> {
  const rows = (await stampRecords()).map((r) => toRow(r.uri, r.value));
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uri.localeCompare(b.uri));
}

export const load: PageServerLoad = async () => {
  const [index, rows] = await Promise.all([getBoardIndex(FORUM_DID()), stampRows()]);
  const boards = index.boards.map((b) => ({ uri: b.uri, name: b.value.name }));
  const boardUris = boards.map((b) => b.uri);
  const boardName = (uri?: string) => boards.find((b) => b.uri === uri)?.name;
  return {
    stamps: rows.map((row) => ({
      ...row,
      triggerText: triggerLabel(row.trigger, boardName(row.trigger.board)),
      retired: retiredByDeletedBoard(row.trigger, boardUris),
    })),
    boards,
    hideDefaultStamps: index.forum?.hideDefaultStamps === true,
  };
};

// Strings throughout so a rejected submission can refill the form as sent.
const fieldsOf = (form: FormData): Record<keyof StampFormFields, string> => ({
  name: String(form.get('name') ?? ''),
  bg: String(form.get('bg') ?? ''),
  ink: String(form.get('ink') ?? ''),
  shape: String(form.get('shape') ?? ''),
  kind: String(form.get('kind') ?? ''),
  board: String(form.get('board') ?? ''),
  before: String(form.get('before') ?? ''),
  via: String(form.get('via') ?? ''),
  confirm: String(form.get('confirm') ?? ''),
});

const readStamps = () => getStamps(FORUM_DID());

// Hold the post-save redirect until the appview has indexed the write.
const saveRedirect = (landed: (stamps: Stamps) => boolean) =>
  savedRedirect(`${HERE}?saved=1`, readStamps, landed);

/** The forum's own stamp record at `uri`, or null for anything else. */
function stampUri(uri: string) {
  const p = parseAtUri(uri);
  return p && p.did === FORUM_DID() && p.collection === STAMP ? p : null;
}

export const actions: Actions = {
  createStamp: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const fields = fieldsOf(form);
    const index = await getBoardIndex(FORUM_DID());
    const parsed = parseStampForm(fields, index.boards.map((b) => b.uri));
    if (!parsed.ok) return fail(400, { message: parsed.error, warning: parsed.warning, fields, uri: 'new' });
    let created: { uri: string };
    try {
      created = await createForumRecord(STAMP, { ...parsed.value, createdAt: new Date().toISOString() });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t create the stamp. Try again.', fields, uri: 'new' });
    }
    await saveRedirect((s) => s.stamps.some((x) => x.uri === created.uri));
  },

  updateStamp: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const p = stampUri(uri);
    const current = p ? (await stampRecords()).find((r) => r.uri === uri) : undefined;
    if (!p || !current) return fail(404, { message: 'Stamp not found.' });
    const fields = fieldsOf(form);
    const index = await getBoardIndex(FORUM_DID());
    const parsed = parseStampForm(fields, index.boards.map((b) => b.uri));
    if (!parsed.ok) return fail(400, { message: parsed.error, warning: parsed.warning, fields, uri });
    const record = {
      ...current.value,
      ...parsed.value,
      createdAt: str(current.value.createdAt) ?? new Date().toISOString(),
    };
    try {
      await putForumRecord(STAMP, p.rkey, record);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the stamp. Try again.', fields, uri });
    }
    await saveRedirect((s) => {
      const x = s.stamps.find((y) => y.uri === uri);
      return (
        !!x &&
        x.name === record.name &&
        JSON.stringify(parseLook(x.look)) === JSON.stringify(record.look) &&
        JSON.stringify(x.trigger) === JSON.stringify(record.trigger)
      );
    });
  },

  // Retire: one record per stamp, so deleting it removes the stamp from every
  // tray and rail at once. Nothing else references it.
  deleteStamp: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    if (!stampUri(uri)) return fail(404, { message: 'Stamp not found.' });
    if (form.get('really') !== 'on') {
      return fail(400, { message: 'Check the confirmation box to retire the stamp. Every member who holds or wears it loses it.' });
    }
    try {
      await deleteForumRecord(uri);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t retire the stamp. Try again.' });
    }
    await saveRedirect((s) => !s.stamps.some((x) => x.uri === uri));
  },

  setHideDefaults: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const hide = form.get('hideDefaults') === 'on';
    let profile: ForumProfile;
    try {
      profile = await currentProfile();
      // Omit the default so old and new records read the same way.
      if (hide) profile.hideDefaultStamps = true;
      else delete profile.hideDefaultStamps;
      await saveProfile(profile);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the default stamps setting. Try again.' });
    }
    await profileRedirect(`${HERE}?saved=defaults`, profile);
  },
};
