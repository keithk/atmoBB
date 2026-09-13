import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { canModerateForum } from '$lib/server/admin';
import { FORUM_DID, getBoardIndex, resolveHandle } from '$lib/server/appview';
import { listInvites, mintInvite, revokeInvite } from '$lib/server/invites';
import { forumStanding } from '$lib/server/membership';
import { banMessage, bannedFrom } from '$lib/server/standing';
import { canMint, inviteState, openInvites } from '$lib/invites';
import { TOKEN } from '$lib/join';
import { canPost } from '$lib/membership';

// A member's own invite links on a gated forum (R6, R7). Staff minting for
// the whole forum lives on the admin page; this one only ever acts as the
// signed-in member.

const DEFAULT_CAP = 3;
const DEFAULT_DAYS = 14;

const limits = (membership: { inviteCap?: number; inviteDays?: number } | undefined) => ({
  cap: membership?.inviteCap ?? DEFAULT_CAP,
  days: membership?.inviteDays ?? DEFAULT_DAYS,
});

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  if (!locals.user) redirect(302, '/login');
  const viewer = locals.user.did;
  const { forum, joinMode, standing } = await parent();
  const { cap, days } = limits(forum.membership);
  const [all, staff] = await Promise.all([listInvites(), canModerateForum(viewer)]);
  const now = new Date();
  const mine = all.filter((i) => i.minter === viewer).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const invites = await Promise.all(
    mine.map(async (i) => ({
      token: i.token,
      state: inviteState(i, now),
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      url: `${url.origin}/join/${i.token}`,
      redeemedBy: i.redeemedBy ? await resolveHandle(i.redeemedBy) : null,
    })),
  );
  const open = openInvites(mine, viewer, now).length;
  return {
    joinMode,
    cap,
    days,
    staff,
    open,
    invites,
    canMint: joinMode !== 'open' && (staff || canPost(standing)) && canMint({ cap, open, staff }),
  };
};

export const actions: Actions = {
  mint: async ({ locals, url }) => {
    if (!locals.user) return fail(401, { message: 'Log in to mint an invite.' });
    const viewer = locals.user.did;
    let profile;
    try {
      profile = (await getBoardIndex(FORUM_DID())).forum;
    } catch {
      return fail(502, { message: "We couldn't read the forum's join settings. Try again in a moment." });
    }
    const { mode, standing } = await forumStanding(viewer, profile);
    if (mode === 'open') return fail(400, { message: 'This forum is open to everyone, so invites are off.' });
    const staff = await canModerateForum(viewer);
    if (!staff) {
      if (!canPost(standing)) {
        return fail(403, {
          message: standing === 'accepted-undeclared' ? 'Finish joining before you invite anyone.' : 'Only members can invite people.',
        });
      }
      const ban = await bannedFrom(viewer);
      if (ban) return fail(403, { message: banMessage(ban) });
    }
    const { cap, days } = limits(profile?.membership);
    let result;
    try {
      result = await mintInvite({ minter: viewer, days, cap, staff });
    } catch {
      return fail(500, { message: "We couldn't save the invite. Try again in a moment." });
    }
    if ('error' in result) return fail(403, { message: result.error });
    return { minted: `${url.origin}/join/${result.invite.token}` };
  },
  revoke: async ({ locals, request }) => {
    if (!locals.user) return fail(401, { message: 'Log in to withdraw an invite.' });
    const token = String((await request.formData()).get('token') ?? '');
    if (!TOKEN.test(token)) return fail(400, { message: 'Invite information is missing.' });
    let ok: boolean;
    try {
      ok = await revokeInvite(token, locals.user.did, false);
    } catch {
      return fail(500, { message: "We couldn't withdraw the invite. Try again in a moment." });
    }
    if (!ok) return fail(409, { message: "That invite is already closed or isn't yours." });
    return { revoked: true };
  },
};
