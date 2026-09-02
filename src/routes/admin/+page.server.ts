import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBoardIndex, FORUM_DID } from '$lib/server/appview';
import { adminActor } from '$lib/server/admin';
import { putForumRecord } from '$lib/server/forum-repo';
import { savedRedirect } from '$lib/server/saved-redirect';

const NS = 'app.atmobb';

type ProfileRecord = {
  name?: string;
  description?: string;
  rules?: { $type: string; text?: string }[];
  [k: string]: unknown;
};

export const load: PageServerLoad = async () => {
  const index = await getBoardIndex(FORUM_DID());
  const profile = (index.forum ?? {}) as ProfileRecord;
  const rulesText = (profile.rules ?? [])
    .map((b) => b.text ?? '')
    .filter(Boolean)
    .join('\n\n');
  return { profile: { name: profile.name ?? '', description: profile.description ?? '' }, rulesText };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });

    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const rulesText = String(form.get('rules') ?? '').trim();
    if (!name) return fail(400, { message: 'Enter a name for the forum.' });

    // Merge onto the current record so fields the form doesn't cover
    // (ranks, links, avatar) survive the put.
    let current: ProfileRecord = {};
    try {
      const index = await getBoardIndex(FORUM_DID());
      current = (index.forum ?? {}) as ProfileRecord;
    } catch {
      return fail(502, { message: "We couldn't reach the appview. Try again in a few minutes." });
    }

    const rules = rulesText
      ? rulesText
          .split(/\n\s*\n/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((text) => ({ $type: `${NS}.richtext.block#text`, text }))
      : undefined;

    const record: ProfileRecord = { ...current, name, description: description || undefined, rules };
    if (!record.description) delete record.description;
    if (!record.rules) delete record.rules;

    try {
      await putForumRecord(`${NS}.forum.profile`, 'self', record);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the forum profile. Try again.' });
    }
    await savedRedirect(
      '/admin?saved=1',
      () => getBoardIndex(FORUM_DID()),
      (i) => {
        const p = (i.forum ?? {}) as ProfileRecord;
        return (
          p.name === record.name &&
          (p.description ?? undefined) === record.description &&
          JSON.stringify(p.rules ?? null) === JSON.stringify(record.rules ?? null)
        );
      },
    );
  },
};
