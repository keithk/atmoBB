import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  getBoardThreads,
  getThreadPage,
  boardUri,
  boardPath,
  threadPath,
  resolveHandle,
  FORUM_DID,
  spaceOfBoard,
  isSpaceMember,
  getBoardAccess,
} from '$lib/server/appview';
import { readSpaceBoardThreads } from '$lib/server/space-read';
import { assertNoImages, createThread, getAccessRequest, requestAccess } from '$lib/server/pds';
import { boardModerator, canModerate } from '$lib/server/admin';
import { createForumRecord } from '$lib/server/forum-repo';
import { parseBBCode } from '$lib/richtext/bbcode';
import { attachImages } from '$lib/server/richtext';
import { addMentionFacets } from '$lib/server/mentions';
import { isThreadAction } from '$lib/moderation';
import { parsePoll } from '$lib/poll';
import { banMessage, bannedFrom } from '$lib/server/standing';

const NS = 'app.atmobb';
const LIMIT = 25;

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const uri = boardUri(params.rkey, params.did);
  const basePath = `/b/${params.did ? `${params.did}/` : ''}${params.rkey}`;
  const cursor = url.searchParams.get('cursor') ?? undefined;
  let page = await getBoardThreads(uri, cursor, LIMIT);
  if (!page.board) error(404, 'Board not found.');

  // Members-only board: content lives in the board's permissioned space. Only
  // members read it; everyone else gets the locked shell + a way to ask in.
  const space = spaceOfBoard(page.board.access);
  let locked = false;
  let member = false;
  let requested = false;
  if (space) {
    member = locals.user ? await isSpaceMember(space, locals.user.did) : false;
    if (member) {
      page = await readSpaceBoardThreads(locals.user!.did, space, page.board);
    } else {
      locked = true;
      requested = locals.user ? !!(await getAccessRequest(locals.user.did, uri)) : false;
      page = { board: page.board, threads: [] };
    }
  }

  const needsHandle = [...new Set(page.threads.filter((t) => !t.authorProfile?.displayName).map((t) => t.author))];
  const handles = Object.fromEntries(
    await Promise.all(needsHandle.map(async (d) => [d, await resolveHandle(d)] as const)),
  );
  const board = page.board;
  if (!board) error(404, 'Board not found.');
  return {
    metadata: {
      title: board.name,
      description: board.description ??
        `${board.threadCount.toLocaleString('en-US')} threads and ${(board.threadCount + board.replyCount).toLocaleString('en-US')} posts.`,
      imageAlt: `${board.name} board`,
      type: 'website' as const,
      noindex: !!space,
      canonical: boardPath(uri, FORUM_DID()),
      structuredData: {
        '@type': 'CollectionPage',
        name: board.name,
        numberOfItems: board.threadCount,
      },
    },
    boardUri: uri,
    basePath,
    handles,
    limit: LIMIT,
    offset: Number(cursor ?? 0),
    canModerate: await canModerate(locals.user?.did, uri),
    private: !!space,
    locked,
    member,
    requested,
    ...page,
  };
};

export const actions: Actions = {
  newThread: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to post.' });

    const form = await request.formData();
    const title = String(form.get('title') ?? '').trim();
    const body = String(form.get('body') ?? '').trim();
    const images = String(form.get('body__images') ?? '');
    if (!title) return fail(400, { message: 'Enter a title for your thread.' });
    const parsed = parsePoll({
      question: String(form.get('pollQuestion') ?? ''),
      options: String(form.get('pollOptions') ?? ''),
      multiple: form.get('pollMultiple') === '1',
      days: String(form.get('pollDays') ?? ''),
    });
    if (parsed && 'error' in parsed) return fail(400, { message: parsed.error });
    const board = boardUri(params.rkey, params.did);
    // The same authoritative, fail-closed check createThread makes, so the
    // friendly refusals below agree with where the post would actually land.
    let space: string | null;
    try {
      space = await getBoardAccess(board);
    } catch {
      return fail(502, { message: "We couldn't confirm this board's settings. Try again." });
    }
    let ban;
    try {
      ban = await bannedFrom(locals.user.did, board, { strict: !!space });
    } catch {
      return fail(502, { message: "We couldn't check your standing. Try again." });
    }
    if (ban) return fail(403, { message: banMessage(ban) });
    // Votes are public records pointing at the thread; a members-only
    // board's threads live in its space, where the tally can't see them.
    if (parsed && space) {
      return fail(400, { message: "Polls aren't available on members-only boards." });
    }
    const blocks = body ? await addMentionFacets(attachImages(parseBBCode(body), images)) : [];
    if (space) {
      try {
        assertNoImages(blocks);
      } catch (e) {
        return fail(400, { message: (e as Error).message });
      }
    }

    let uri: string;
    try {
      const res = await createThread(locals.user.did, {
        board,
        title,
        body: blocks,
        ...(parsed ? { poll: parsed.poll } : {}),
      });
      uri = res.uri;
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t post your thread. Try again.' });
    }
    redirect(303, `${threadPath(uri)}?fresh=1`);
  },

  // Ask a members-only board's moderators for access. Writes an accessRequest
  // record into the requester's repo; a sysop resolves it from the mod queue.
  requestAccess: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to request access.' });
    const board = boardUri(params.rkey, params.did);
    const ban = await bannedFrom(locals.user.did, board);
    if (ban) return fail(403, { message: banMessage(ban) });
    const form = await request.formData();
    const reason = String(form.get('reason') ?? '').trim() || undefined;
    try {
      await requestAccess(locals.user.did, board, reason);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t submit your request. Try again.' });
    }
    redirect(303, `/b/${params.did ? `${params.did}/` : ''}${params.rkey}?requested=1`);
  },

  // Staff: flip a thread flag. Hiding a thread on this forum's own boards is
  // an origin hide (propagates everywhere); hiding a merged foreign thread
  // only shapes this forum's view. Locks and pins are the origin's alone.
  moderateThread: async ({ params, request, locals }) => {
    if (!(await boardModerator(locals, boardUri(params.rkey, params.did)))) {
      return fail(403, { message: 'Only staff for this board can moderate threads.' });
    }
    const form = await request.formData();
    const action = String(form.get('action') ?? '');
    const uri = String(form.get('uri') ?? '');
    const cid = String(form.get('cid') ?? '');
    if (!isThreadAction(action)) return fail(400, { message: 'Unknown moderation action.' });
    if (!uri || !cid) return fail(400, { message: 'Thread information is missing.' });
    if (action !== 'hide' && action !== 'unhide') {
      const { thread } = await getThreadPage(uri, { limit: 1 });
      if (!thread) return fail(404, { message: 'Thread not found.' });
      if (thread.origin) return fail(400, { message: "Only a thread's own forum can lock or pin it." });
    }
    try {
      await createForumRecord(`${NS}.moderation.action`, {
        subject: { $type: 'com.atproto.repo.strongRef', uri, cid },
        action,
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t moderate this thread. Try again.' });
    }
    redirect(303, `/b/${params.did ? `${params.did}/` : ''}${params.rkey}?moderated=1`);
  },

  // Staff: block a foreign forum from this board's merged stream.
  blockForum: async ({ params, request, locals }) => {
    if (!(await boardModerator(locals, boardUri(params.rkey, params.did)))) {
      return fail(403, { message: 'Only staff for this board can block forums.' });
    }
    const form = await request.formData();
    const subjectDid = String(form.get('did') ?? '');
    if (!subjectDid.startsWith('did:')) return fail(400, { message: 'Forum information is missing.' });
    if (subjectDid === FORUM_DID()) return fail(400, { message: "You can't block this forum." });
    try {
      await createForumRecord(`${NS}.moderation.action`, {
        subject: { $type: `${NS}.moderation.action#account`, did: subjectDid },
        action: 'block',
        board: boardUri(params.rkey, params.did),
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t block this forum. Try again.' });
    }
    redirect(303, `/b/${params.did ? `${params.did}/` : ''}${params.rkey}?moderated=1`);
  },
};
