import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { FORUM_DID, getAccessRequests, getBoardIndex } from '$lib/server/appview';
import { forumStanding } from '$lib/server/membership';
import { applyToForum } from '$lib/server/pds';
import { savedRedirect } from '$lib/server/saved-redirect';
import { banMessage, bannedFrom } from '$lib/server/standing';
import { applyView, canApply, noteTooLong, NOTE_MAX_GRAPHEMES, type ApplicantState, type ApplyView } from './state';

const DEFAULT_PROMPT = "Tell the moderators why you'd like to join.";

/**
 * The applicant's state as the moderators see it. The appview's forum queue
 * already folds every decision into one state per applicant (accepted ones
 * drop out, and those have a standing of their own), so the page reads the
 * same source the admin does rather than rebuilding it from the applicant's
 * record and a capped moderation log.
 */
async function applicantState(did: string): Promise<ApplicantState> {
  const res = await getAccessRequests(FORUM_DID(), { kind: 'forum', limit: 1, requester: did });
  return res.requests[0]?.state ?? 'none';
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  if (!locals.user) redirect(302, `/login?next=${encodeURIComponent(url.pathname)}`);
  const { joinMode, standing, forum } = await parent();
  const did = locals.user.did;
  // A forum-wide ban refuses an application the way it refuses an invite.
  // Only a non-member of an apply-mode forum has an application to look up.
  let view: ApplyView;
  const ban = await bannedFrom(did);
  if (ban) view = { kind: 'banned', message: banMessage(ban) };
  else {
    const state = joinMode === 'apply' && standing === 'nonmember' ? await applicantState(did) : 'none';
    view = applyView(joinMode, standing, state);
  }
  return {
    view,
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
      const ban = await bannedFrom(did, undefined, { strict: true });
      if (ban) return fail(403, { message: banMessage(ban), note });
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
