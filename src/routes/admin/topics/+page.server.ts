import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBoardIndex, getModerationLog, getTopic, getTopics, FORUM_DID, type Topic, type Topics } from '$lib/server/appview';
import { adminActor } from '$lib/server/admin';
import { createForumRecord, putForumRecord } from '$lib/server/forum-repo';
import { savedRedirect } from '$lib/server/saved-redirect';
import { parseAtUri } from '$lib/appview-paths';
import { ACTIVE, actionKey, INVERSE } from '$lib/moderation';

const NS = 'app.atmobb';

const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const load: PageServerLoad = async ({ url }) => {
  const previewSlug = slugify(url.searchParams.get('preview') ?? '');
  const [index, log, preview, directory] = await Promise.all([
    getBoardIndex(FORUM_DID()),
    getModerationLog(FORUM_DID(), 30).catch(() => ({ actions: [] })),
    previewSlug ? getTopic(previewSlug).catch((): Topic | null => null) : null,
    getTopics().catch((): Topics => ({ topics: [] })),
  ]);
  // Latest action per thread flag (or per forum and board) wins; only the
  // ones still in force get an undo.
  const seen = new Set<string>();
  const active = log.actions.filter((a) => {
    const key = actionKey(a.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return ACTIVE.has(a.value.action);
  });
  return {
    boards: index.boards.filter((b) => !b.value.parent),
    activeActions: active,
    preview,
    previewSlug,
    directory: directory.topics,
  };
};

export const actions: Actions = {
  setTopic: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const p = parseAtUri(uri);
    const index = await getBoardIndex(FORUM_DID());
    const board = index.boards.find((b) => b.uri === uri);
    if (!p || !board) return fail(404, { message: 'Board not found.' });

    const topic = slugify(String(form.get('topic') ?? ''));
    const federation = String(form.get('federation') ?? 'open');
    const allowRaw = String(form.get('allow') ?? '').trim();
    const topicAllow = allowRaw
      ? allowRaw.split(/[\s,]+/).filter((d) => d.startsWith('did:'))
      : undefined;

    const record: Record<string, unknown> = { ...board.value };
    if (topic) {
      record.topic = topic;
      if (federation === 'allowlist') {
        record.topicFederation = 'allowlist';
        record.topicAllow = topicAllow ?? [];
      } else {
        delete record.topicFederation;
        delete record.topicAllow;
      }
    } else {
      delete record.topic;
      delete record.topicFederation;
      delete record.topicAllow;
    }

    try {
      await putForumRecord(`${NS}.forum.board`, p.rkey, record);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save this topic. Try again.' });
    }
    await savedRedirect(
      '/admin/topics?saved=1',
      () => getBoardIndex(FORUM_DID()),
      (i) => {
        const b = i.boards.find((x) => x.uri === uri);
        return (
          !!b &&
          (b.value.topic ?? undefined) === record.topic &&
          (b.value.topicFederation ?? undefined) === record.topicFederation &&
          JSON.stringify(b.value.topicAllow ?? null) === JSON.stringify(record.topicAllow ?? null)
        );
      },
    );
  },

  undo: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const action = String(form.get('action') ?? '');
    const inverse = ACTIVE.has(action) ? INVERSE[action] : null;
    if (!inverse) return fail(400, { message: 'There is nothing to undo.' });

    const subjectUri = String(form.get('subjectUri') ?? '');
    const subjectCid = String(form.get('subjectCid') ?? '');
    const subjectDid = String(form.get('subjectDid') ?? '');
    const board = String(form.get('board') ?? '');
    const subject = subjectUri
      ? { $type: 'com.atproto.repo.strongRef', uri: subjectUri, cid: subjectCid }
      : { $type: `${NS}.moderation.action#account`, did: subjectDid };

    try {
      await createForumRecord(`${NS}.moderation.action`, {
        subject,
        action: inverse,
        ...(board ? { board } : {}),
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t undo this action. Try again.' });
    }
    // The undo row disappears once the inverse action is the latest entry for
    // this flag in the indexed log (same key the load's filter uses).
    const key = actionKey({ subject, action, ...(board ? { board } : {}) });
    await savedRedirect(
      '/admin/topics?saved=1',
      () => getModerationLog(FORUM_DID(), 30),
      (log) => log.actions.find((a) => actionKey(a.value) === key)?.value.action === inverse,
    );
  },
};
