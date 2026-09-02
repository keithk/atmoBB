import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { canModerate, canModerateForum } from '$lib/server/admin';
import { getBoardIndex, getStanding, FORUM_DID } from '$lib/server/appview';
import { createForumRecord } from '$lib/server/forum-repo';
import { savedRedirect } from '$lib/server/saved-redirect';
import { revokeSpaceAccess } from '$lib/server/space-access';
import { expiryFromDays } from '$lib/standing';

const NS = 'app.atmobb';

/** The staff member allowed to act on `board` (or forum-wide), or a 403. */
async function actor(locals: App.Locals, board?: string) {
  const did = locals.user?.did;
  const ok = board ? await canModerate(did, board) : await canModerateForum(did);
  return ok ? did! : null;
}
import {
  resolveActor,
  getPublicProfile,
  getAtmobbActivity,
  getElsewhere,
  presenceFor,
} from '$lib/server/profiles';
import { resolveHandle } from '$lib/server/appview';
import { resolveBodyImages } from '$lib/server/richtext';

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  const id = await resolveActor(params.actor);
  if (!id) error(404, 'No member by that name.');

  const { forum, forumDid, staffRole } = await parent();
  const ranks = forum.ranks ?? [];
  // Standing is shown to the member themself and to staff, who can act on it.
  const isYou = locals.user?.did === id.did;
  const showStanding = isYou || !!staffRole;

  const [profile, activity, elsewhere, standing, index] = await Promise.all([
    getPublicProfile(id.did, id.pds),
    getAtmobbActivity(id.did, forumDid),
    getElsewhere(id.did, id.pds, id.handle),
    showStanding ? getStanding(id.did, forumDid).catch(() => null) : null,
    staffRole ? getBoardIndex(forumDid).catch(() => null) : null,
  ]);
  await resolveBodyImages([{ author: id.did, body: profile?.signature }]);

  // Threads on other forums link to those forums' own sites — forum account
  // handles double as site domains. Unresolvable handles fall back to null
  // and the row links locally.
  const originDids = [
    ...new Set(
      activity.recentThreads.filter((t) => t.forum.did !== forumDid).map((t) => t.forum.did),
    ),
  ];
  const forumSites: Record<string, string | null> = Object.fromEntries(
    await Promise.all(
      originDids.map(async (did) => {
        const handle = await resolveHandle(did);
        return [did, handle && handle !== did ? `https://${handle}` : null] as const;
      }),
    ),
  );

  const displayName = profile?.displayName ?? id.handle;
  const canonical = `${url.origin}/members/${encodeURIComponent(id.handle)}`;
  const image = `${url.origin}/members/${encodeURIComponent(params.actor)}/og.png`;
  const activityDescription =
    activity.global.posts > 0
      ? `@${id.handle} · ${activity.global.posts.toLocaleString('en-US')} public atmobb posts`
      : `@${id.handle}`;
  const metadata = {
    title: displayName,
    description: profile?.description?.trim() || activityDescription,
    image,
    imageAlt: `${displayName} (@${id.handle})`,
    type: 'profile' as const,
    profileUsername: id.handle,
    noindex: false,
    canonical,
    structuredData: {
      '@type': 'ProfilePage',
      mainEntity: {
        '@type': 'Person',
        name: displayName,
        alternateName: `@${id.handle}`,
        identifier: id.did,
        url: canonical,
        ...(profile?.description ? { description: profile.description } : {}),
      },
    },
  };

  return {
    metadata,
    member: {
      did: id.did,
      handle: id.handle,
      presence: presenceFor(id.did),
      profile,
      activity,
      elsewhere,
    },
    ranks,
    forumSites,
    isYou,
    standing,
    boards: (index?.boards ?? []).map((b) => ({ uri: b.uri, name: b.value.name })),
  };
};

export const actions: Actions = {
  warn: async ({ params, request, locals }) => {
    const id = await resolveActor(params.actor);
    if (!id) return fail(404, { message: 'No member by that name.' });
    const form = await request.formData();
    const board = String(form.get('board') ?? '') || undefined;
    const reason = String(form.get('reason') ?? '').trim();
    if (!(await actor(locals, board))) return fail(403, { message: 'Only staff for this scope can warn members.' });
    if (!reason) return fail(400, { message: 'Say what the warning is for.' });
    const before = (await getStanding(id.did, FORUM_DID()).catch(() => null))?.warnings.length ?? 0;
    try {
      await createForumRecord(`${NS}.moderation.action`, {
        subject: { $type: `${NS}.moderation.action#account`, did: id.did },
        action: 'warn',
        reason,
        ...(board ? { board } : {}),
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t record the warning. Try again.' });
    }
    await savedRedirect(
      `/members/${encodeURIComponent(params.actor)}?saved=1`,
      () => getStanding(id.did, FORUM_DID()),
      (s) => s.warnings.length > before,
    );
  },

  ban: async ({ params, request, locals }) => {
    const id = await resolveActor(params.actor);
    if (!id) return fail(404, { message: 'No member by that name.' });
    if (id.did === locals.user?.did) return fail(400, { message: "You can't ban yourself." });
    const form = await request.formData();
    const board = String(form.get('board') ?? '') || undefined;
    const reason = String(form.get('reason') ?? '').trim() || undefined;
    const expiresAt = expiryFromDays(String(form.get('days') ?? ''));
    if (!(await actor(locals, board))) return fail(403, { message: 'Only staff for this scope can ban members.' });
    if (await canModerateForum(id.did)) return fail(400, { message: 'Remove them from staff before banning them.' });
    try {
      await createForumRecord(`${NS}.moderation.action`, {
        subject: { $type: `${NS}.moderation.action#account`, did: id.did },
        action: 'ban',
        ...(reason ? { reason } : {}),
        ...(board ? { board } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t record the ban. Try again.' });
    }
    // A ban only blocks writes; membership is what lets them read a private
    // board. Drop them from every space the ban covers.
    try {
      await revokeSpaceAccess(id.did, board);
    } catch (e) {
      return fail(502, {
        message: `The ban is recorded, but removing them from members-only boards failed: ${e instanceof Error ? e.message : 'space error'}. Remove them from Boards in the admin area.`,
      });
    }
    await savedRedirect(
      `/members/${encodeURIComponent(params.actor)}?saved=1`,
      () => getStanding(id.did, FORUM_DID()),
      (s) => s.bans.some((b) => (b.board ?? '') === (board ?? '')),
    );
  },

  unban: async ({ params, request, locals }) => {
    const id = await resolveActor(params.actor);
    if (!id) return fail(404, { message: 'No member by that name.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const ban = (await getStanding(id.did, FORUM_DID())).bans.find((b) => b.uri === uri);
    if (!ban) return fail(404, { message: 'That ban is no longer in force.' });
    if (!(await actor(locals, ban.board))) return fail(403, { message: 'Only staff for this scope can lift bans.' });
    try {
      await createForumRecord(`${NS}.moderation.action`, {
        subject: { $type: `${NS}.moderation.action#account`, did: id.did },
        action: 'unban',
        ...(ban.board ? { board: ban.board } : {}),
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t lift the ban. Try again.' });
    }
    await savedRedirect(
      `/members/${encodeURIComponent(params.actor)}?saved=1`,
      () => getStanding(id.did, FORUM_DID()),
      (s) => !s.bans.some((b) => b.uri === uri),
    );
  },
};
