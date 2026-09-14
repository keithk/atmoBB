import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { FORUM_DID, getBoardIndex } from '$lib/server/appview';
import { boardPath } from '$lib/appview-paths';
import { agentFor } from '$lib/server/atproto-oauth';
import { getActorProfile, saveProfile, getWatches, unwatchBoard, watchFailureMessage } from '$lib/server/pds';
import { blobCid, blobUrl, bustProfileCache } from '$lib/server/profiles';
import { forumProfileOverride, profileForForum } from '$lib/profile-overrides';
import { canRetryTurnOn, enableNotifications, forumPermissionDetails, optInDeps, recheckPending } from '$lib/server/notify/optin';
import { safeReturnPath } from '$lib/server/notify/return-path';
import { readMember, setPromptDismissed, setStatus } from '$lib/server/notify/store';

const DASHBOARD_URL = 'https://atmo.pub';
const SETTINGS_PATH = '/settings/notifications';

// What atmo.pub shows the member when asked to approve this forum. Looked up
// here rather than taken from the layout because actions have no parent().
type BoardIndex = Awaited<ReturnType<typeof getBoardIndex>>;

async function permissionDetails(index?: BoardIndex) {
  const { forum } = index ?? (await getBoardIndex(FORUM_DID()));
  const cid = blobCid(forum?.favicon);
  const iconUrl = cid ? await blobUrl(FORUM_DID(), cid) : null;
  return forumPermissionDetails(forum?.name ?? 'atmoBB', iconUrl);
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) redirect(302, '/login');
  const did = locals.user.did;
  const deps = optInDeps(agentFor);
  const [watches, index, profile] = await Promise.all([getWatches(did, FORUM_DID()), getBoardIndex(FORUM_DID()), getActorProfile(did)]);
  // KTD14: a member who approved in atmo.pub since their last visit flips to
  // on here, since the relay does not call this forum back yet.
  if (deps) await recheckPending({ did, deps, ...(await permissionDetails(index)) });
  const member = await readMember(did).catch(() => null);
  const names = new Map(index.boards.map((b) => [b.uri, b.value.name]));
  return {
    globalNotifications: profile?.notifications !== false ? 'on' : 'off',
    localNotifications: forumProfileOverride(profile, FORUM_DID())?.fields.includes('notifications')
      ? (profileForForum(profile, FORUM_DID())?.notifications !== false ? 'on' : 'off') : 'inherit',
    status: member?.status ?? 'off',
    canSend: deps !== null,
    canRetry: canRetryTurnOn(member, Date.now()),
    dashboardUrl: DASHBOARD_URL,
    // Set after the re-login fallback (AE13), so the turn-on form can carry
    // the flag through its own action URL.
    reconsented: url.searchParams.has('reconsented'),
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
  preferences: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to change your notifications.' });
    const fd = await request.formData();
    const scope = fd.get('scope');
    const preference = fd.get('notifications');
    if ((scope !== 'all' && scope !== 'forum') ||
        (preference !== 'on' && preference !== 'off' && !(scope === 'forum' && preference === 'inherit'))) {
      return fail(400, { message: 'Choose a valid notification preference and scope.' });
    }
    try {
      await saveProfile(locals.user.did, { notifications: preference === 'on' }, scope === 'forum' ? FORUM_DID() : undefined, preference === 'inherit' ? ['notifications'] : []);
      bustProfileCache(locals.user.did);
      return { saved: true };
    } catch (error) {
      return fail(502, { message: error instanceof Error ? error.message : 'Could not save notification preferences.' });
    }
  },
  enable: async ({ request, locals, url }) => {
    if (!locals.user) return fail(401, { message: 'Log in to change your notifications.' });
    const did = locals.user.did;
    const form = await request.formData();
    const deps = optInDeps(agentFor);
    if (!deps) return fail(503, { message: "This forum can't send notifications yet." });
    let member;
    try {
      member = await readMember(did);
    } catch {
      return fail(500, { message: "Couldn't read your notification settings. Try again in a moment." });
    }
    if (!canRetryTurnOn(member, Date.now())) {
      return fail(429, { message: 'Still waiting for your approval on atmo.pub. You can ask again in a few minutes.' });
    }
    let result;
    try {
      result = await enableNotifications({ did, deps, ...(await permissionDetails()) });
    } catch {
      return fail(500, { message: "Couldn't save your notification settings. Try again in a moment." });
    }
    if (result.outcome === 'reconsent') {
      // KTD3: a session from before the permission set changed has to consent
      // again. Once is enough; a second refusal means the set is still
      // propagating, and looping through login would not help.
      if (url.searchParams.has('reconsented') || form.get('reconsented') === '1') {
        return fail(409, { message: "The forum's permissions are still propagating on your account. Try again later." });
      }
      redirect(303, `/login?next=${encodeURIComponent(`${SETTINGS_PATH}?reconsented=1`)}`);
    }
    if (result.outcome === 'pds-error' || result.outcome === 'relay-error') {
      return fail(502, { message: result.message });
    }
    // The prompt and the notifications page post here too, so land on a
    // clean GET of wherever the member was rather than a POST result.
    redirect(303, safeReturnPath(form.get('next')) ?? SETTINGS_PATH);
  },
  disable: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to change your notifications.' });
    const next = safeReturnPath((await request.formData()).get('next')) ?? SETTINGS_PATH;
    try {
      await setStatus(locals.user.did, 'off');
    } catch {
      return fail(500, { message: "Couldn't save your notification settings. Try again in a moment." });
    }
    redirect(303, next);
  },
  dismissPrompt: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to change your notifications.' });
    const next = safeReturnPath((await request.formData()).get('next')) ?? '/';
    try {
      await setPromptDismissed(locals.user.did);
    } catch {
      // The member said no; a store hiccup should not trap them on an error page.
    }
    redirect(303, next);
  },
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
