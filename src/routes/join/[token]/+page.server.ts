import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { FORUM_DID, getMembership, resolveHandle } from '$lib/server/appview';
import { createForumRecord } from '$lib/server/forum-repo';
import { getInvite, redeemInvite, releaseInvite, reserveInvite, revokeInvite } from '$lib/server/invites';
import { declareMembership } from '$lib/server/membership';
import { savedRedirect } from '$lib/server/saved-redirect';
import { bannedFrom } from '$lib/server/standing';
import { inviteState } from '$lib/invites';
import { JOIN_MESSAGES, TOKEN, joinView } from '$lib/join';

// The token in the URL is the whole secret, so nothing on this page may send
// it anywhere: no referrer on outbound links, and no store change on GET.

const loginFor = (token: string) => `/login?next=${encodeURIComponent(`/join/${token}`)}`;

/** Both checks that refuse without touching the invite (R24; banned cannot
 *  redeem). Fail closed: an unanswered appview reads as unknown, not clear. */
async function viewerStanding(viewer: string) {
  const [member, banned] = await Promise.all([
    getMembership(viewer, FORUM_DID()).then((m) => m.accepted).catch(() => 'unknown' as const),
    bannedFrom(viewer, undefined, { strict: true }).then((ban) => !!ban).catch(() => 'unknown' as const),
  ]);
  return { member, banned };
}

export const load: PageServerLoad = async ({ params, locals, parent, setHeaders }) => {
  const { token } = params;
  if (!TOKEN.test(token)) error(404, 'Not found');
  setHeaders({ 'Referrer-Policy': 'no-referrer' });
  if (!locals.user) redirect(302, loginFor(token));
  const viewer = locals.user.did;
  const [{ forum }, invite, standing] = await Promise.all([
    parent(),
    getInvite(token).catch(() => null),
    viewerStanding(viewer),
  ]);
  // A store read error is `null`; a missing token is `undefined`.
  const view = invite === null
    ? 'trouble'
    : joinView({ invite: invite ? inviteState(invite) : 'unknown', ...standing });
  return {
    view,
    message: view === 'confirm' ? null : JOIN_MESSAGES[view],
    forumName: forum.name,
    inviter: view === 'confirm' && invite ? await resolveHandle(invite.minter) : null,
  };
};

export const actions: Actions = {
  confirm: async ({ params, locals }) => {
    const { token } = params;
    if (!TOKEN.test(token)) error(404, 'Not found');
    if (!locals.user) redirect(303, loginFor(token));
    const viewer = locals.user.did;

    // 1. Standing first, so a member or a banned account never reserves.
    const standing = await viewerStanding(viewer);
    if (standing.member === 'unknown' || standing.banned === 'unknown') return fail(502, { message: JOIN_MESSAGES.trouble });
    if (standing.member) return fail(409, { message: JOIN_MESSAGES.member });
    if (standing.banned) return fail(403, { message: JOIN_MESSAGES.banned });

    // 2. Claim the token before the network write, so a double submission
    //    or a second person with the same link cannot both get in on it.
    let reserved: Awaited<ReturnType<typeof reserveInvite>>;
    try {
      reserved = await reserveInvite(token);
    } catch {
      return fail(500, { message: JOIN_MESSAGES.trouble });
    }
    if ('state' in reserved) {
      // `open` cannot come back here; every other state has a message.
      const state = reserved.state === 'open' ? 'trouble' : reserved.state;
      return fail(409, { message: JOIN_MESSAGES[state] });
    }
    const { invite } = reserved;

    // 3. The forum signs the acceptance; the sponsor is whoever minted (R10).
    try {
      await createForumRecord('app.atmobb.moderation.action', {
        subject: { $type: 'app.atmobb.moderation.action#account', did: viewer },
        action: 'acceptMember',
        sponsor: invite.minter,
        via: 'invite',
      });
    } catch (e) {
      // Give the link back; the acceptance never happened.
      await releaseInvite(token).catch(() => {});
      return fail(502, { message: e instanceof Error ? e.message : "The forum couldn't record your acceptance. Try again." });
    }

    // 4. Spend the link. They are accepted either way now, so a store hiccup
    //    here is logged rather than shown. The reservation would lapse and
    //    reopen the link, so after a second try the link is revoked instead.
    try {
      await redeemInvite(token, viewer);
    } catch (e) {
      const spent = await redeemInvite(token, viewer).catch(() => false);
      if (!spent) {
        await revokeInvite(token, invite.minter, true).catch(() => {});
        console.error('invite redeemed but not marked spent', token.slice(0, 8), e);
      }
    }

    // 5. Their own declaration. The masthead offers "finish joining" if this
    //    part fails, so say so instead of failing the whole redemption.
    try {
      await declareMembership(viewer, FORUM_DID());
    } catch {
      return { accepted: true, message: "You're accepted; finish joining from the home page." };
    }

    // 6. Land on the home page once the index shows the acceptance.
    await savedRedirect('/?joined=1', () => getMembership(viewer, FORUM_DID()), (m) => m.accepted);
  },
};
