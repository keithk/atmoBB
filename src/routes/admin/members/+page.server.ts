import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  getBoardIndex,
  getAccessRequests,
  getLatestThreads,
  getMembers,
  getMembership,
  FORUM_DID,
  addSpaceMember,
  removeSpaceMember,
  isSpaceMember,
  spaceOfBoard,
  resolveHandle,
} from '$lib/server/appview';
import type { ForumApplications, ForumMembershipSettings, ForumProfile, SpaceMember, ThreadSummary } from '$lib/server/appview';
import { boardMembers } from '$lib/server/space-access';
import { adminActor, canModerateForum, forumStaff, isAdmin } from '$lib/server/admin';
import { createForumRecord, createForumRecords, putForumRecord } from '$lib/server/forum-repo';
import { listInvites, mintInvite, revokeInvite } from '$lib/server/invites';
import { savedRedirect } from '$lib/server/saved-redirect';
import { grandfatherSet } from '$lib/application';
import { inviteState } from '$lib/invites';
import { joinMode, resolvedHandle, sponsorLine, type JoinMode } from '$lib/membership';

const NS = 'app.atmobb';
const ACTION = `${NS}.moderation.action`;
const account = (did: string) => ({ $type: `${ACTION}#account`, did });

type MembershipSettings = ForumMembershipSettings;

const DEFAULT_CAP = 3;
const DEFAULT_DAYS = 14;

const settingsOf = (profile?: ForumProfile) => (profile?.membership ?? {}) as MembershipSettings;

/** Gated modes need the appview to answer getMembership; an older instance
 *  can't enforce them, so the form only offers them when it does. */
const gatingAvailable = (forumDid: string) =>
  getMembership(forumDid, forumDid).then(() => true, () => false);

/** DIDs seen posting in this forum's public threads. The feed carries each
 *  thread's author, last replier, and up to five participants, so a long
 *  thread's quieter repliers can be missed — the roster covers anyone who
 *  also declared membership. Merged-topic threads from other forums are
 *  skipped. */
function posterDids(threads: ThreadSummary[], forumDid: string): string[] {
  const out: string[] = [];
  for (const t of threads) {
    if (!t.board.startsWith(`at://${forumDid}/`)) continue;
    out.push(t.author);
    if (t.lastReplyBy) out.push(t.lastReplyBy);
    for (const p of t.participants ?? []) out.push(p.did);
  }
  return out;
}

/** Everyone an open forum would grandfather if it gated now: every declared
 *  member plus every poster the public feed shows. */
async function grandfatherDids(forumDid: string): Promise<string[]> {
  const declarers: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await getMembers(cursor, 100, forumDid);
    declarers.push(...page.members.map((m) => m.did));
    cursor = page.cursor;
  } while (cursor);
  const posters: string[] = [];
  cursor = undefined;
  do {
    const page = await getLatestThreads(cursor, 100, forumDid);
    posters.push(...posterDids(page.threads, forumDid));
    cursor = page.cursor;
  } while (cursor);
  return grandfatherSet(declarers, posters, forumDid);
}

/** Drop the DIDs that already hold an open window (a forum that gated
 *  before keeps its acceptances when it opens), twenty lookups at a time. */
async function withoutAccepted(dids: string[], forumDid: string): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < dids.length; i += 20) {
    const slice = dids.slice(i, i + 20);
    const accepted = await Promise.all(
      slice.map((did) => getMembership(did, forumDid).then((m) => m.accepted, () => false)),
    );
    out.push(...slice.filter((_, j) => !accepted[j]));
  }
  return out;
}

type Application = ForumApplications['requests'][number];

/** The open application from `did`, read from the appview rather than
 *  trusted from the form. */
async function findApplication(did: string): Promise<Application | undefined> {
  const page = await getAccessRequests(FORUM_DID(), { kind: 'forum', limit: 1, requester: did });
  return page.requests[0];
}

async function handlesFor(dids: Iterable<string>): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all([...new Set(dids)].map(async (did) => [did, await resolveHandle(did)] as const)),
  );
}

export const load: PageServerLoad = async ({ url }) => {
  const forumDid = FORUM_DID();
  const [index, available] = await Promise.all([getBoardIndex(forumDid), gatingAvailable(forumDid)]);
  const settings = settingsOf(index.forum);
  const mode = joinMode(settings);
  const gated = mode !== 'open';

  // What gating would do right now, so the admin sees the number before
  // confirming. Only an open forum can be gated.
  let grandfatherCount: number | null = null;
  if (!gated && available) {
    grandfatherCount = await grandfatherDids(forumDid).then((d) => d.length, () => null);
  }

  let applications: Application[] = [];
  let applicationsCursor: string | undefined;
  if (gated) {
    try {
      const res = await getAccessRequests(forumDid, {
        kind: 'forum',
        limit: 50,
        cursor: url.searchParams.get('applications') ?? undefined,
      });
      applications = res.requests;
      applicationsCursor = res.cursor;
    } catch {
      // getAccessRequests may not know kind=forum yet on older instances.
    }
  }

  const invites = gated
    ? (await listInvites()).map((i) => ({
        prefix: i.token.slice(0, 8),
        minter: i.minter,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        state: inviteState(i),
      }))
    : [];
  invites.reverse();

  const roster = await getMembers(url.searchParams.get('members') ?? undefined, 50, forumDid);

  // Board access requests and the readers of each private board, as the
  // boards page used to show them.
  const spaceByBoard = new Map(
    index.boards.map((b) => [b.uri, spaceOfBoard(b.value.access)] as const),
  );
  let requests: Awaited<ReturnType<typeof getAccessRequests>>['requests'] = [];
  try {
    const res = await getAccessRequests(forumDid);
    const checked = await Promise.all(
      res.requests.map(async (r) => {
        const space = spaceByBoard.get(r.board);
        if (!space) return null; // board went public or vanished
        return (await isSpaceMember(space, r.requester)) ? null : r;
      }),
    );
    requests = checked.filter((r): r is NonNullable<typeof r> => r !== null);
  } catch {
    // getAccessRequests may not be registered yet on older instances.
  }
  const members: Record<string, (SpaceMember & { handle: string })[]> = {};
  await Promise.all(
    [...spaceByBoard].map(async ([uri, space]) => {
      if (!space) return;
      try {
        const list = await boardMembers(space);
        members[uri] = await Promise.all(
          list.map(async (m) => ({ ...m, handle: await resolveHandle(m.did) })),
        );
      } catch {
        // space unreachable — the row just shows no member list
      }
    }),
  );

  const handles = await handlesFor([
    ...applications.map((a) => a.requester),
    ...invites.map((i) => i.minter),
    ...roster.members.flatMap((m) => (m.sponsor ? [m.did, m.sponsor] : [m.did])),
  ]);
  const name = (did: string) => {
    const h = resolvedHandle(handles, did);
    return h ? `@${h}` : undefined;
  };

  return {
    mode,
    settings: {
      prompt: settings.prompt ?? '',
      inviteCap: settings.inviteCap ?? DEFAULT_CAP,
      inviteDays: settings.inviteDays ?? DEFAULT_DAYS,
      gatedSince: settings.gatedSince,
    },
    gatingAvailable: available,
    grandfatherCount,
    applications,
    applicationsCursor,
    invites,
    roster: {
      members: roster.members.map((m) => ({
        ...m,
        line: gated && m.since ? sponsorLine({ since: m.since, sponsor: m.sponsor, via: m.via }, name) : undefined,
      })),
      cursor: roster.cursor,
    },
    handles,
    privateBoards: index.boards.filter((b) => spaceByBoard.get(b.uri)).map((b) => ({ uri: b.uri, name: b.value.name })),
    requests,
    members,
  };
};

async function currentBoard(uri: string) {
  const index = await getBoardIndex(FORUM_DID());
  return index.boards.find((b) => b.uri === uri);
}

const intField = (v: FormDataEntryValue | null, fallback: number, min: number, max: number): number | null => {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Answer a forum application: accept, deny, or hold. The request's ref and
 *  the sponsor come from the appview and the session, never the form. */
async function decideApplication(
  locals: App.Locals,
  request: Request,
  action: 'acceptMember' | 'denyAccess' | 'holdApplication',
) {
  const actor = locals.user?.did;
  if (!(await canModerateForum(actor))) return fail(403, { message: 'Only forum-wide staff can review applications.' });
  const form = await request.formData();
  const did = String(form.get('did') ?? '');
  if (!did.startsWith('did:')) return fail(400, { message: 'Applicant information is missing.' });
  const app = await findApplication(did).catch(() => undefined);
  if (!app) return fail(404, { message: 'That application is no longer open.' });
  try {
    await createForumRecord(ACTION, {
      subject: account(did),
      action,
      ...(action === 'acceptMember' ? { sponsor: actor, via: 'application' } : {}),
      ...(app.cid ? { ref: { uri: app.uri, cid: app.cid } } : {}),
    });
  } catch (e) {
    return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t record this decision. Try again.' });
  }
  // An accepted applicant leaves the queue; the others change state in it.
  const settled = { acceptMember: undefined, denyAccess: 'denied', holdApplication: 'waiting' }[action];
  await savedRedirect(
    '/admin/members?saved=1',
    () => findApplication(did),
    (row) => (settled ? row?.state === settled : !row),
  );
}

export const actions: Actions = {
  // How people join. Gating an open forum also writes the gateForum action
  // and accepts everyone already here as founding members; opening a gated
  // forum writes openForum and leaves the acceptances in place.
  setMode: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const forumDid = FORUM_DID();
    const form = await request.formData();
    const mode = String(form.get('mode') ?? 'open') as JoinMode;
    if (mode !== 'open' && mode !== 'apply' && mode !== 'invite') return fail(400, { message: 'Choose a join mode.' });
    const prompt = String(form.get('prompt') ?? '').trim();
    const inviteCap = intField(form.get('inviteCap'), DEFAULT_CAP, 0, 100);
    const inviteDays = intField(form.get('inviteDays'), DEFAULT_DAYS, 1, 365);
    if (inviteCap === null) return fail(400, { message: 'The invite cap must be a whole number from 0 to 100.' });
    if (inviteDays === null) return fail(400, { message: 'Invite expiry must be a whole number of days from 1 to 365.' });

    let current: ForumProfile;
    try {
      const index = await getBoardIndex(forumDid);
      if (!index.forum) throw new Error('forum profile not found');
      current = index.forum;
    } catch {
      return fail(502, { message: "We couldn't reach the appview. Try again in a few minutes." });
    }
    const before = joinMode(settingsOf(current));
    const gating = before === 'open' && mode !== 'open';
    const opening = before !== 'open' && mode === 'open';
    if (mode !== 'open' && !(await gatingAvailable(forumDid))) {
      return fail(400, { message: "Membership gating isn't available until the appview is updated." });
    }
    if (gating && form.get('really') !== 'on') {
      return fail(400, { message: 'Check the confirmation box to gate the forum.' });
    }

    const membership: MembershipSettings = { ...settingsOf(current), mode, inviteCap, inviteDays };
    if (prompt) membership.prompt = prompt;
    else delete membership.prompt;
    if (gating) membership.gatedSince = new Date().toISOString();
    const profile: ForumProfile = { ...current, membership };

    // Read the founding set before the gate goes up: once gated, the roster
    // only lists accepted members.
    let founding: string[] = [];
    if (gating) {
      try {
        founding = await withoutAccepted(await grandfatherDids(forumDid), forumDid);
      } catch (e) {
        return fail(502, { message: `We couldn't list the current members: ${e instanceof Error ? e.message : 'appview error'}. Nothing was changed.` });
      }
    }
    try {
      await putForumRecord(`${NS}.forum.profile`, 'self', profile);
      if (gating) await createForumRecord(ACTION, { subject: account(forumDid), action: 'gateForum', mode });
      else if (opening) await createForumRecord(ACTION, { subject: account(forumDid), action: 'openForum' });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save the join mode. Try again.' });
    }
    if (founding.length) {
      try {
        await createForumRecords(
          ACTION,
          founding.map((did) => ({ subject: account(did), action: 'acceptMember', via: 'founding' })),
        );
      } catch (e) {
        return fail(502, {
          message: `The forum is now gated, but accepting its ${founding.length} original members failed: ${e instanceof Error ? e.message : 'write error'}. Set the mode back to open, then gate it again.`,
        });
      }
    }
    await savedRedirect(
      '/admin/members?saved=1',
      () => getBoardIndex(forumDid),
      (i) => {
        const m = settingsOf(i.forum);
        return joinMode(m) === mode && (m.gatedSince ?? '') === (membership.gatedSince ?? '');
      },
    );
  },

  approve: ({ request, locals }) => decideApplication(locals, request, 'acceptMember'),
  deny: ({ request, locals }) => decideApplication(locals, request, 'denyAccess'),
  hold: ({ request, locals }) => decideApplication(locals, request, 'holdApplication'),

  // A staff invite: no cap, expiry from the profile. The link is shown once,
  // in this response, and never in the listing.
  mint: async ({ locals }) => {
    const actor = locals.user?.did;
    if (!(await canModerateForum(actor))) return fail(403, { message: 'Only forum-wide staff can mint invites.' });
    const settings = settingsOf((await getBoardIndex(FORUM_DID()).catch(() => undefined))?.forum);
    if (joinMode(settings) === 'open') return fail(400, { message: 'Invites only apply while the forum is gated.' });
    const res = await mintInvite({ minter: actor!, days: settings.inviteDays ?? DEFAULT_DAYS, cap: 0, staff: true });
    if ('error' in res) return fail(400, { message: res.error });
    return { minted: { path: `/join/${res.invite.token}`, expiresAt: res.invite.expiresAt } };
  },

  // The listing shows token prefixes only, so the form sends the prefix and
  // the full token is looked up here.
  revokeInvite: async ({ request, locals }) => {
    const actor = locals.user?.did;
    if (!(await canModerateForum(actor))) return fail(403, { message: 'Only forum-wide staff can revoke invites.' });
    const form = await request.formData();
    const prefix = String(form.get('prefix') ?? '');
    const matches = prefix.length >= 8 ? (await listInvites()).filter((i) => i.token.startsWith(prefix)) : [];
    if (matches.length !== 1) return fail(404, { message: 'Invite not found.' });
    const ok = await revokeInvite(matches[0].token, actor!, await isAdmin(actor));
    if (!ok) return fail(400, { message: "That invite can't be revoked: it's already spent, expired, or someone else's." });
    redirect(303, '/admin/members?saved=1');
  },

  // End someone's membership. Their posts stay; they can apply again.
  remove: async ({ request, locals }) => {
    const actor = locals.user?.did;
    if (!(await canModerateForum(actor))) return fail(403, { message: 'Only forum-wide staff can remove members.' });
    const form = await request.formData();
    const did = String(form.get('did') ?? '');
    if (!did.startsWith('did:')) return fail(400, { message: 'Member information is missing.' });
    if (did === FORUM_DID()) return fail(400, { message: "The forum account can't be removed from its own forum." });
    if ((await forumStaff()).some((s) => s.subject === did)) {
      return fail(400, { message: 'Remove them from staff before removing them from the forum.' });
    }
    const standing = await getMembership(did, FORUM_DID()).catch(() => null);
    if (!standing?.accepted) return fail(400, { message: "They aren't a member right now." });
    try {
      await createForumRecord(ACTION, { subject: account(did), action: 'revokeMember' });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t remove this member. Try again.' });
    }
    await savedRedirect(
      '/admin/members?saved=1',
      () => getMembership(did, FORUM_DID()),
      (m) => !m.accepted,
    );
  },

  // Grant a pending access request: add the requester to the board's space as a
  // write member. Once they're a member the queue drops them automatically.
  approveRequest: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const boardUri = String(form.get('board') ?? '');
    const did = String(form.get('did') ?? '');
    const board = await currentBoard(boardUri);
    const space = board && spaceOfBoard(board.value.access);
    if (!space) return fail(404, { message: 'That board is not members-only.' });
    try {
      await addSpaceMember(space, did, 'write');
      await createForumRecord(`${NS}.moderation.action`, {
        subject: account(did),
        action: 'grantAccess',
        board: boardUri,
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t approve this request. Try again.' });
    }
    redirect(303, '/admin/members?saved=1');
  },

  // Deny a request: record a denyAccess moderation.action so the queue stops
  // surfacing it (getAccessRequests filters denied requests out).
  denyRequest: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const boardUri = String(form.get('board') ?? '');
    const did = String(form.get('did') ?? '');
    try {
      await createForumRecord(`${NS}.moderation.action`, {
        subject: account(did),
        action: 'denyAccess',
        board: boardUri,
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t deny this request. Try again.' });
    }
    // The queue only drops the request once the denyAccess action is indexed.
    await savedRedirect(
      '/admin/members?saved=1',
      () => getAccessRequests(FORUM_DID()),
      (r) => !r.requests.some((x) => x.board === boardUri && x.requester === did),
    );
  },

  // Take a member out of a private board: remove them from its space, then
  // record a revokeAccess action so the queue treats their old request as
  // settled. They can ask again.
  removeMember: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    const form = await request.formData();
    const boardUri = String(form.get('board') ?? '');
    const did = String(form.get('did') ?? '');
    if (!did.startsWith('did:')) return fail(400, { message: 'Member information is missing.' });
    if (did === FORUM_DID()) return fail(400, { message: "The forum account can't be removed from its own space." });
    const board = await currentBoard(boardUri);
    const space = board && spaceOfBoard(board.value.access);
    if (!space) return fail(404, { message: 'That board is not members-only.' });
    try {
      await removeSpaceMember(space, did);
      await createForumRecord(`${NS}.moderation.action`, {
        subject: account(did),
        action: 'revokeAccess',
        board: boardUri,
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t remove this member. Try again.' });
    }
    redirect(303, '/admin/members?saved=1');
  },
};
