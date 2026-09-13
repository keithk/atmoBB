import type { InviteState } from './invites';

/** What the join page shows for one invite and one viewer. Only `confirm`
 *  offers the button; everything else is a refusal that spends nothing. */
export type JoinView =
  | 'unknown'
  | 'expired'
  | 'revoked'
  | 'redeemed'
  | 'reserved'
  | 'member'
  | 'banned'
  | 'trouble'
  | 'confirm';

/** The token in the link: 26 lowercase base32 characters (invites.ts). */
export const TOKEN = /^[a-z2-7]{26}$/;

/**
 * Pick the view. An existing member is told so before anything about the
 * link, since the link's state is beside the point for them (R24). The ban
 * check is the only one that needs the appview, so it comes last and an
 * unanswered one reads as trouble rather than as clearance.
 */
export function joinView(input: {
  invite: InviteState | 'unknown';
  member: boolean | 'unknown';
  banned: boolean | 'unknown';
}): JoinView {
  if (input.invite === 'unknown') return 'unknown';
  if (input.member === 'unknown') return 'trouble';
  if (input.member) return 'member';
  if (input.invite !== 'open') return input.invite;
  if (input.banned === 'unknown') return 'trouble';
  if (input.banned) return 'banned';
  return 'confirm';
}

export const JOIN_MESSAGES: Record<Exclude<JoinView, 'confirm'>, string> = {
  unknown: "This invite link doesn't exist. Check that you copied the whole link.",
  expired: 'This invite has expired. Ask the person who invited you for a new one.',
  revoked: 'This invite was withdrawn. Ask the person who invited you for a new one.',
  redeemed: 'This invite has already been used. Each link admits one person.',
  reserved: 'Someone is redeeming this invite right now. If that was you, wait a moment and reload.',
  member: "You're already a member of this forum.",
  banned: "You're banned from this forum, so this invite can't be used.",
  trouble: "We couldn't check this invite right now. Try again in a moment.",
};
