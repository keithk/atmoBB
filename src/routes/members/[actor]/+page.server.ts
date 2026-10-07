import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { canModerate, canModerateForum, forumStaff } from '$lib/server/admin';
import {
  getBoardIndex,
  getMembership,
  getStamps,
  getStanding,
  getThreadPage,
  isSpaceMember,
  parseSpaceUri,
  spaceUriOf,
  FORUM_DID,
  type Stamps,
  type ThreadPage,
  type TrayEntry,
} from '$lib/server/appview';
import { readSpaceThreadPage } from '$lib/server/space-read';
import { createForumRecord } from '$lib/server/forum-repo';
import { savedRedirect } from '$lib/server/saved-redirect';
import { revokeSpaceAccess } from '$lib/server/space-access';
import { joinMode, sponsorDisplay } from '$lib/membership';
import { sponsorDids, wornFromTray } from '$lib/stamps';
import { banCovering, expiryFromDays } from '$lib/standing';
import { MAX_PINS, profileLook, resolvePanels } from '$lib/profile-page';
import { parseAtUri } from '$lib/appview-paths';
import type { RichTextBlock } from '$lib/richtext/bbcode';

const NS = 'app.atmobb';

/** The staff member allowed to act on `board` (or forum-wide), or a 403. */
async function actor(locals: App.Locals, board?: string) {
  const did = locals.user?.did;
  const ok = board ? await canModerate(did, board) : await canModerateForum(did);
  return ok ? did! : null;
}

/** The forum's hand-awarded stamp definitions; these are the only ones staff give and take. */
const byHandStamps = (set: Stamps | null) => (set?.stamps ?? []).filter((s) => s.trigger.kind === 'byHand');

/** Whether the tray holds `uri` as a by-hand award (a matching admin trigger doesn't count). */
const holdsByHand = (tray: TrayEntry[], uri: string) => tray.some((e) => e.source === 'byHand' && e.id === uri);
import {
  resolveActor,
  getPublicProfile,
  getAtmobbActivity,
  getElsewhere,
  presenceFor,
} from '$lib/server/profiles';
import { resolveHandle } from '$lib/server/appview';
import { resolveBodyImages } from '$lib/server/richtext';

const THREAD = `${NS}.discussion.thread`;

/** Profile fields a banned owner's plain page leaves out of the page data. */
const PLAIN_FIELDS = ['profileSkin', 'banner', 'headline', 'currently', 'about'];

/**
 * Whether `uri` is a topic `owner` wrote on this forum, judged on the URI
 * alone: a public thread's authority, or a space thread's author segment in
 * one of this forum's spaces. Checked before anything is read.
 */
function ownTopic(uri: string, owner: string, forumDid: string): boolean {
  const spaced = parseSpaceUri(uri);
  if (spaced) {
    return uri.split('/').length === 9 && spaced.space.startsWith(`at://${forumDid}/`) && spaced.author === owner && spaced.collection === THREAD;
  }
  const ref = parseAtUri(uri);
  return ref?.did === owner && ref.collection === THREAD;
}

/** A pinned topic as the page shows it. note is set only on the owner's own view. */
interface PinCard {
  uri: string;
  title: string | null;
  boardName: string | null;
  createdAt: string | null;
  replyCount: number;
  /** restricted: only people who can read its board see it. gone: it no longer reads. */
  note: 'restricted' | 'gone' | null;
}

/**
 * Read a pin as `reader` (undefined for a logged-out visitor) the way the
 * thread pages do: a space thread only for a member of its space, a public
 * thread from the index, which leaves out hidden and unfederated ones.
 */
async function readPin(
  uri: string,
  reader: string | undefined,
  memberOf: (space: string) => Promise<boolean>,
): Promise<{ thread: ThreadPage['thread'] | null; replyCount: number; restricted: boolean; member: boolean }> {
  const space = spaceUriOf(uri);
  if (space) {
    const member = !!reader && (await memberOf(space));
    const page = member ? await readSpaceThreadPage(reader!, uri).catch(() => null) : null;
    return { thread: page?.thread ?? null, replyCount: page?.replyCount ?? 0, restricted: true, member };
  }
  const page = await getThreadPage(uri, { limit: 1, viewer: reader }).catch(() => null);
  const thread = page?.thread;
  const readable = !!thread && !thread.hidden && !(thread.origin && !thread.origin.federated);
  return { thread: readable ? thread : null, replyCount: page?.replyCount ?? 0, restricted: false, member: true };
}

/**
 * The owner's pins as this viewer sees them: the first four, only their own
 * topics, each read as the viewer in parallel. Visitors get the ones that
 * read; the owner gets every one, flagged when visitors can't see it.
 */
async function pinCards(
  pinned: unknown,
  owner: string,
  forumDid: string,
  reader: string | undefined,
  asOwner: boolean,
  boardNames: Map<string, string>,
): Promise<PinCard[]> {
  const uris = (Array.isArray(pinned) ? pinned : [])
    .slice(0, MAX_PINS)
    .filter((uri): uri is string => typeof uri === 'string' && ownTopic(uri, owner, forumDid));
  // Pins in the same space share one membership check.
  const spaces = new Map<string, Promise<boolean>>();
  const memberOf = (space: string) => {
    if (!spaces.has(space)) spaces.set(space, isSpaceMember(space, reader!));
    return spaces.get(space)!;
  };
  const reads = await Promise.all([...new Set(uris)].map(async (uri) => ({ uri, ...(await readPin(uri, reader, memberOf)) })));
  return reads.flatMap(({ uri, thread, replyCount, restricted, member }) => {
    if (!thread && !asOwner) return [];
    // The owner learns why visitors won't see a pin: a members-only board it
    // reads on (or they can no longer read), or a topic that no longer reads.
    let note: PinCard['note'] = null;
    if (asOwner && restricted && (thread || !member)) note = 'restricted';
    else if (asOwner && !thread) note = 'gone';
    return [{
      uri,
      title: thread?.value.title ?? null,
      boardName: (thread && boardNames.get(thread.value.board)) ?? null,
      createdAt: thread?.value.createdAt ?? null,
      replyCount,
      note,
    } satisfies PinCard];
  });
}

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  const id = await resolveActor(params.actor);
  if (!id) error(404, 'No member by that name.');

  const { forum, forumDid, staffRole, sidebarBoards } = await parent();
  const isOwner = locals.user?.did === id.did;
  // ?as=visitor previews the page as a logged-out visitor, for the owner only.
  const preview = isOwner && url.searchParams.get('as') === 'visitor';
  const isYou = isOwner && !preview;
  // Standing is shown to the member themself and to staff, who can act on it.
  const showStanding = isYou || (!preview && !!staffRole);
  const gated = joinMode(forum.membership as { mode?: string } | undefined) !== 'open';

  // Standing is read for every viewer because a forum-wide ban turns the page
  // plain; its details reach only the viewers showStanding allows.
  const boardNames = new Map((sidebarBoards ?? []).map((b) => [b.uri, b.value.name] as const));
  // Pins start reading as soon as the stamps (which carry them) arrive.
  const stampsRead = getStamps(forumDid, id.did).catch(() => null);
  const pinsRead = stampsRead.then((set) =>
    pinCards(set?.pinned, id.did, forumDid, preview ? undefined : locals.user?.did, isYou, boardNames),
  );
  const [fullProfile, activity, elsewhere, standingRead, membership, index, stampSet, forumWide, pins] = await Promise.all([
    getPublicProfile(id.did, id.pds),
    getAtmobbActivity(id.did, forumDid),
    getElsewhere(id.did, id.pds, id.handle),
    getStanding(id.did, forumDid).catch(() => null),
    gated ? getMembership(id.did, forumDid).catch(() => null) : null,
    staffRole ? getBoardIndex(forumDid).catch(() => null) : null,
    stampsRead,
    // Only forum-wide staff give and revoke stamps; a board-scoped moderator sees no control.
    staffRole ? canModerateForum(locals.user?.did) : false,
    pinsRead,
  ]);
  // Board-only bans leave the page as the owner made it.
  const ownerBanned = !!standingRead && !!banCovering(standingRead.bans);
  const standing = showStanding ? standingRead : null;
  const forumHidesSkins = forum.hideProfileSkins === true;
  const look = profileLook({
    profileSkin: fullProfile?.profileSkin,
    banner: fullProfile?.banner,
    forumHidesSkins,
    ownerBanned,
  });
  const profile = look.plain && fullProfile ? { ...fullProfile } : fullProfile;
  if (look.plain && profile) for (const key of PLAIN_FIELDS) delete profile[key];
  const about = Array.isArray(profile?.about) ? (profile.about as RichTextBlock[]) : [];
  await resolveBodyImages([
    { author: id.did, body: profile?.signature },
    { author: id.did, body: about },
  ]);

  // Everyone sees the stamps they wear (the arrival stamp names its sponsor)
  // and the whole tray on the shelf, worn ones first; staff and the member
  // themself also see the Standing card's sponsor line and whom they brought
  // in. All display only.
  const tray = stampSet?.tray ?? [];
  const stamps = wornFromTray(tray, stampSet?.worn ?? []);
  const wornIds = new Set(stamps.map((entry) => entry.id));
  const shelf = [...stamps, ...tray.filter((entry) => !wornIds.has(entry.id))];
  const [sponsorHandle, sponsored, handleEntries] = await Promise.all([
    membership?.sponsor ? resolveHandle(membership.sponsor) : null,
    showStanding && membership
      ? Promise.all(membership.sponsored.map(async (s) => ({ ...s, handle: await resolveHandle(s.did) })))
      : null,
    Promise.all(sponsorDids(shelf).map(async (did) => [did, await resolveHandle(did)] as const)),
  ]);
  const handles = Object.fromEntries(handleEntries);
  const sponsor =
    membership?.accepted && membership.since
      ? sponsorDisplay(
          { since: membership.since, sponsor: membership.sponsor, via: membership.via },
          membership.sponsor ? { [membership.sponsor]: sponsorHandle } : {},
        )
      : null;
  const sponsorText = sponsor?.text ?? null;
  const sponsorResolved = sponsor?.handle ?? null;

  // The by-hand definitions with whether this member holds each, for the
  // give/revoke control. Absent unless the viewer may act on them.
  const stampsByHand = forumWide
    ? byHandStamps(stampSet).map((s) => ({ uri: s.uri, name: s.name, held: holdsByHand(stampSet?.tray ?? [], s.uri) }))
    : null;

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

  const sig = Array.isArray(profile?.signature) ? profile.signature : [];
  const panels = resolvePanels({
    panels: profile?.panels,
    hasContent: {
      about: about.length > 0,
      pinned: pins.length > 0,
      stamps: shelf.length > 0,
      activity: activity.recentThreads.length > 0,
      bluesky: elsewhere.posts.length > 0,
      signature: sig.length > 0,
    },
    viewer: isYou ? 'owner' : 'visitor',
    plain: look.plain,
  });
  // One-line explanations only the owner sees, when the forum overrides their page.
  const notices = isYou
    ? { skinsOff: forumHidesSkins && !!fullProfile?.profileSkin, plain: ownerBanned }
    : null;

  const displayName = profile?.displayName ?? id.handle;
  const canonical = `${url.origin}/members/${encodeURIComponent(id.handle)}`;
  const image = `${url.origin}/members/${encodeURIComponent(params.actor)}/og.png`;
  const metadata = {
    title: displayName,
    description: profile?.description?.trim() || `@${id.handle}`,
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
    forumSites,
    isYou,
    preview,
    look,
    panels,
    pins,
    shelf,
    notices,
    standing,
    membership,
    sponsorHandle: sponsorResolved,
    sponsorText,
    sponsored,
    stamps,
    handles,
    stampsByHand,
    boards: (index?.boards ?? []).map((b) => ({ uri: b.uri, name: b.value.name })),
  };
};

/**
 * Give or take back a by-hand stamp, as a moderation action that names the
 * stamp record and the staffer. Only forum-wide staff, only this forum's
 * byHand definitions, and only a change: giving a stamp they hold or revoking
 * one they don't is refused rather than written. Never touches what they wear.
 */
async function stampAction(
  params: { actor: string },
  request: Request,
  locals: App.Locals,
  action: 'awardStamp' | 'revokeStamp',
) {
  const id = await resolveActor(params.actor);
  if (!id) return fail(404, { message: 'No member by that name.' });
  const viewer = await actor(locals);
  if (!viewer) return fail(403, { message: 'Only forum-wide staff can give or revoke stamps.' });
  const form = await request.formData();
  const uri = String(form.get('stamp') ?? '');
  const set = await getStamps(FORUM_DID(), id.did).catch(() => null);
  const stamp = byHandStamps(set).find((s) => s.uri === uri);
  if (!stamp) return fail(400, { message: "That isn't one of this forum's hand-awarded stamps." });
  const held = holdsByHand(set?.tray ?? [], uri);
  if (action === 'awardStamp' && held) return fail(400, { message: `They already hold ${stamp.name}.` });
  if (action === 'revokeStamp' && !held) return fail(400, { message: `They don't hold ${stamp.name}, so there's nothing to revoke.` });
  try {
    await createForumRecord(`${NS}.moderation.action`, {
      subject: { $type: `${NS}.moderation.action#account`, did: id.did },
      action,
      ref: { uri: stamp.uri, cid: stamp.cid },
      actor: viewer,
    });
  } catch (e) {
    return fail(502, { message: e instanceof Error ? e.message : "We couldn't record the stamp change. Try again." });
  }
  await savedRedirect(
    `/members/${encodeURIComponent(params.actor)}?saved=1`,
    () => getStamps(FORUM_DID(), id.did),
    (s) => holdsByHand(s.tray ?? [], uri) === (action === 'awardStamp'),
  );
}

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
        message: `The ban is recorded, but removing them from members-only boards failed: ${e instanceof Error ? e.message : 'space error'}. Remove them from Members in the admin area.`,
      });
    }
    // A forum-wide ban also ends their membership on a gated forum, on the
    // record. Lifting the ban later does not bring it back.
    if (!board) {
      try {
        await createForumRecord(`${NS}.moderation.action`, {
          subject: { $type: `${NS}.moderation.action#account`, did: id.did },
          action: 'revokeMember',
        });
      } catch (e) {
        return fail(502, {
          message: `The ban is recorded, but ending their membership failed: ${e instanceof Error ? e.message : 'write error'}. Remove them from Members in the admin area.`,
        });
      }
    }
    await savedRedirect(
      `/members/${encodeURIComponent(params.actor)}?saved=1`,
      () => getStanding(id.did, FORUM_DID()),
      (s) => s.bans.some((b) => (b.board ?? '') === (board ?? '')),
    );
  },

  // End someone's membership on a gated forum. Their posts stay; they can
  // apply again. Staff must leave staff first, the same rule as a ban.
  remove: async ({ params, locals }) => {
    const id = await resolveActor(params.actor);
    if (!id) return fail(404, { message: 'No member by that name.' });
    if (id.did === locals.user?.did) return fail(400, { message: "You can't remove yourself." });
    if (!(await actor(locals))) return fail(403, { message: 'Only forum-wide staff can remove members.' });
    if (id.did === FORUM_DID()) return fail(400, { message: "The forum account can't be removed from its own forum." });
    if ((await forumStaff()).some((s) => s.subject === id.did)) {
      return fail(400, { message: 'Remove them from staff before removing them from the forum.' });
    }
    const membership = await getMembership(id.did, FORUM_DID()).catch(() => null);
    if (!membership?.accepted) return fail(400, { message: "They aren't a member right now." });
    try {
      await createForumRecord(`${NS}.moderation.action`, {
        subject: { $type: `${NS}.moderation.action#account`, did: id.did },
        action: 'revokeMember',
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t remove this member. Try again.' });
    }
    await savedRedirect(
      `/members/${encodeURIComponent(params.actor)}?saved=1`,
      () => getMembership(id.did, FORUM_DID()),
      (m) => !m.accepted,
    );
  },

  award: ({ params, request, locals }) => stampAction(params, request, locals, 'awardStamp'),
  revoke: ({ params, request, locals }) => stampAction(params, request, locals, 'revokeStamp'),

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
