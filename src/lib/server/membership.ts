import { fail } from '@sveltejs/kit';
import { getBoardIndex, getMembership as getAcceptance, FORUM_DID, type ForumProfile } from './appview';
import { getMembership as getDeclaration, joinForum, type Membership as Declaration } from './pds';
import { canPost, joinMode, standingFor, type JoinMode, type MembershipWindow, type Standing } from '$lib/membership';

export interface ForumStanding {
  mode: JoinMode;
  standing: Standing;
  /** The viewer's open acceptance, when the forum has one for them. */
  window?: MembershipWindow;
  /** Whether the viewer's own membership declaration exists. */
  declared: boolean;
}

/**
 * The viewer's standing on this forum: open, or on a gated forum whether the
 * forum has accepted them and they have declared membership themselves (R3).
 *
 * On an open forum nothing is fetched. For public writes, appview trouble
 * reads as "not a member": the index enforces membership at read time too
 * (KD3), so a write that slips through still won't show. Space writes have no
 * such backstop, so callers pass `strict` and the appview error propagates.
 * A declaration already read for the request can be passed in to skip the
 * PDS read.
 */
export async function forumStanding(
  viewer: string | undefined,
  profile: ForumProfile | undefined,
  opts: { declaration?: Declaration | null; strict?: boolean } = {},
): Promise<ForumStanding> {
  const mode = joinMode(profile?.membership);
  const forumDid = FORUM_DID();
  if (mode === 'open' || !viewer || viewer === forumDid) {
    return { mode, standing: standingFor({ mode, forumDid, viewer, declared: false }), declared: false };
  }
  const [acceptance, declaration] = await Promise.all([
    opts.strict ? getAcceptance(viewer, forumDid) : getAcceptance(viewer, forumDid).catch(() => null),
    opts.declaration === undefined ? getDeclaration(viewer, forumDid) : opts.declaration,
  ]);
  // `since` comes with every acceptance the appview reports as open.
  const window = acceptance?.accepted && acceptance.since
    ? { since: acceptance.since, sponsor: acceptance.sponsor, via: acceptance.via }
    : undefined;
  const declared = !!declaration?.joined;
  return { mode, standing: standingFor({ mode, forumDid, viewer, window, declared }), window, declared };
}

/** The message a non-member sees when a write is refused on a gated forum. */
export function membershipMessage(mode: JoinMode, standing: Standing): string {
  if (standing === 'accepted-undeclared') return 'Finish joining to post.';
  const hint = mode === 'invite' ? 'This forum is invite only.' : 'Apply to join first.';
  return `Only members can post here. ${hint}`;
}

/**
 * The refusal a write action returns for a non-member of a gated forum, or
 * undefined when the write may proceed. Shaped like the ban refusal, and
 * checked after it. Callers have already required a login.
 */
export async function refuseUnlessMember(locals: App.Locals, opts: { strict?: boolean } = {}) {
  if (!locals.user) return undefined;
  let profile: ForumProfile | undefined;
  try {
    profile = (await getBoardIndex(FORUM_DID())).forum;
  } catch (e) {
    if (opts.strict) throw e;
    return undefined;
  }
  const { mode, standing } = await forumStanding(locals.user.did, profile, { strict: opts.strict });
  if (canPost(standing)) return undefined;
  return fail(403, { message: membershipMessage(mode, standing) });
}

// One declaration write per DID at a time, so a double-submitted "Finish
// joining" form can't leave two records behind.
const joining = new Map<string, Promise<void>>();

/**
 * Write the viewer's membership declaration unless one already exists.
 * Returning after leaving is just declaring again (R20); the forum's
 * acceptance is untouched either way.
 */
export function declareMembership(did: string, forum = FORUM_DID()): Promise<void> {
  const inFlight = joining.get(did);
  if (inFlight) return inFlight;
  const write = (async () => {
    const current = await getDeclaration(did, forum);
    if (current?.joined) return;
    await joinForum(did, forum);
  })().finally(() => joining.delete(did));
  joining.set(did, write);
  return write;
}
