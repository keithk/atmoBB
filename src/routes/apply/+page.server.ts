import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { FORUM_DID, getAccessRequests, getBoardIndex } from '$lib/server/appview';
import { forumStanding } from '$lib/server/membership';
import { applyToForum } from '$lib/server/pds';
import { savedRedirect } from '$lib/server/saved-redirect';
import { applyView, canApply, noteTooLong, NOTE_MAX_GRAPHEMES, type ApplicantState } from './state';

const DEFAULT_PROMPT = "Tell the moderators why you'd like to join.";

// The queue holds one row per open applicant; a few pages covers a busy forum.
const MAX_PAGES = 20;

/**
 * The applicant's state as the moderators see it. The appview's forum queue
 * already folds every decision into one state per applicant (accepted ones
 * drop out, and those have a standing of their own), so the page reads the
 * same source the admin does rather than rebuilding it from the applicant's
 * record and a capped moderation log.
 */
async function applicantState(did: string): Promise<ApplicantState> {
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await getAccessRequests(FORUM_DID(), { kind: 'forum', limit: 100, cursor });
    const mine = res.requests.find((r) => r.requester === did);
    if (mine) return mine.state;
    if (!res.cursor) break;
    cursor = res.cursor;
  }
  return 'none';
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  if (!locals.user) redirect(302, `/login?next=${encodeURIComponent(url.pathname)}`);
  const { joinMode, standing, forum } = await parent();
  // Only a non-member of an apply-mode forum has an application to look up.
  const state = joinMode === 'apply' && standing === 'nonmember' ? await applicantState(locals.user.did) : 'none';
  return {
    view: applyView(joinMode, standing, state),
    prompt: forum.membership?.prompt?.trim() || DEFAULT_PROMPT,
    noteMax: NOTE_MAX_GRAPHEMES,
    sent: url.searchParams.has('sent'),
    pending: url.searchParams.has('pending'),
  };
};

export const actions: Actions = {
  default: async ({ locals, request }) => {
    if (!locals.user) return fail(401, { message: 'Log in to apply.' });
    const did = locals.user.did;
    const form = await request.formData();
    const note = String(form.get('note') ?? '').trim();
    if (!note) return fail(400, { message: 'Write a note for the moderators.', note });
    if (noteTooLong(note)) return fail(400, { message: `Keep your note to ${NOTE_MAX_GRAPHEMES} characters.`, note });
    let allowed: boolean;
    try {
      const profile = (await getBoardIndex(FORUM_DID())).forum;
      const { mode, standing } = await forumStanding(did, profile, { strict: true });
      const state = mode === 'apply' && standing === 'nonmember' ? await applicantState(did) : 'none';
      allowed = canApply(mode, standing, state);
    } catch {
      return fail(502, { message: "We couldn't check your application. Try again.", note });
    }
    if (!allowed) return fail(403, { message: 'There is nothing to apply for right now.', note });
    try {
      await applyToForum(did, FORUM_DID(), note);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : "We couldn't send your application. Try again.", note });
    }
    return savedRedirect('/apply?sent=1', () => applicantState(did), (state) => state === 'pending');
  },
};
