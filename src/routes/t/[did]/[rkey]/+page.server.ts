import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBoardThreads, getThreadPage, threadUri, resolveHandle, FORUM_DID } from '$lib/server/appview';
import { castVote, createReply, deletePost, retractVote, updatePost } from '$lib/server/pds';
import { pollClosed } from '$lib/poll';
import { banMessage, bannedFrom } from '$lib/server/standing';
import { blocksToDoc } from '$lib/richtext/blocks-tiptap';
import { blocksToPlainText } from '$lib/richtext/plain';
import { boardPath, postAnchor, postAuthor } from '$lib/appview-paths';
import type { RichTextBlock } from '$lib/richtext/bbcode';

const QUOTE = 'app.atmobb.richtext.block#quote';

interface Post {
  uri: string;
  cid?: string;
  author: string;
  body?: RichTextBlock[];
}
import { boardModerator, canModerate } from '$lib/server/admin';
import { createForumRecord } from '$lib/server/forum-repo';
import { savedRedirect } from '$lib/server/saved-redirect';
import { actionFamily, isThreadAction } from '$lib/moderation';
import { presenceFor } from '$lib/server/profiles';
import { parseBBCode } from '$lib/richtext/bbcode';
import { attachImages, resolveBodyImages } from '$lib/server/richtext';
import { addMentionFacets } from '$lib/server/mentions';
import { THREAD_PAGE_SIZE as LIMIT } from '$lib/appview-paths';

const NS = 'app.atmobb';

async function handleMap(dids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(dids)];
  const entries = await Promise.all(unique.map(async (d) => [d, await resolveHandle(d)] as const));
  return Object.fromEntries(entries);
}

export const load: PageServerLoad = async ({ params, url, parent, locals }) => {
  const uri = threadUri(params.did, params.rkey);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const fresh = url.searchParams.has('fresh');
  const page = await getThreadPage(uri, { cursor, limit: LIMIT, viewer: locals.user?.did });
  // A thread from another forum only renders here when topic federation
  // brings it in. Otherwise it belongs to its origin forum's site — forum
  // account handles double as site domains — so send the visitor there.
  const origin = page.thread?.origin;
  if (origin && !origin.federated) {
    const handle = await resolveHandle(origin.did);
    if (handle && handle !== origin.did) {
      redirect(302, `https://${handle}/t/${params.did}/${params.rkey}`);
    }
    error(404, 'This thread lives on another forum.');
  }
  const [{ forum, staffRole }, boardName] = await Promise.all([
    parent(),
    page.thread
      ? getBoardThreads(page.thread.value.board, undefined, 1)
          .then((boardPage) => boardPage.board?.name)
          .catch(() => undefined)
      : undefined,
  ]);
  // A hidden thread is gone as far as members are concerned. Staff still see
  // it, flagged, so the hide can be reviewed and undone.
  if (page.thread?.hidden && !staffRole) {
    error(404, 'Thread not found.');
  }
  await resolveBodyImages([
    ...(page.thread ? [{ author: page.thread.author, body: page.thread.value.body }] : []),
    ...page.replies.map((r) => ({ author: r.author, body: r.value.body })),
    ...(page.thread ? [{ author: page.thread.author, body: page.thread.authorProfile?.signature }] : []),
    ...page.replies.map((r) => ({ author: r.author, body: r.authorProfile?.signature })),
  ]);
  const waiting = fresh && !page.thread;
  // ?to=<rkey> answers a post; ?quote=<rkey> answers it with its text quoted.
  // Both are plain links, so replying in context works without JavaScript.
  const posts: Post[] = [
    ...(page.thread ? [{ uri, cid: page.thread.cid, author: page.thread.author, body: page.thread.value.body }] : []),
    ...page.replies.map((r) => ({ uri: r.uri, cid: r.cid, author: r.author, body: r.value.body })),
  ];
  const quoteRkey = url.searchParams.get('quote');
  const toRkey = quoteRkey ?? url.searchParams.get('to');
  const target = toRkey ? posts.find((p) => p.uri.endsWith(`/${toRkey}`)) : undefined;
  const replyTo = target?.cid ? { uri: target.uri, cid: target.cid, author: target.author } : null;
  const composerDoc =
    replyTo && quoteRkey
      ? blocksToDoc([{ $type: QUOTE, text: blocksToPlainText(target!.body), subject: { uri: replyTo.uri, cid: replyTo.cid } }])
      : null;
  // The post rail shows @handle for every author, not just handle-less ones,
  // and reply-to lines and quote attributions name their authors too.
  const authors = [
    ...posts.map((p) => p.author),
    ...page.replies.flatMap((r) => (r.value.parent ? [postAuthor(r.value.parent.uri)] : [])),
    ...posts.flatMap((p) => (p.body ?? []).flatMap((b) => (b.subject ? [postAuthor(b.subject.uri)] : []))),
  ];
  const uniqueAuthors = [...new Set(authors)];
  const handles = await handleMap(uniqueAuthors);
  const presence = Object.fromEntries(uniqueAuthors.map((d) => [d, presenceFor(d)]));
  const metadata = page.thread
    ? (() => {
        const title = page.thread.value.title;
        const authorHandle = handles[page.thread.author] ?? page.thread.author;
        const authorName = page.thread.authorProfile?.displayName ?? `@${authorHandle}`;
        const opening = blocksToPlainText(page.thread.value.body).replace(/\s+/g, ' ').trim();
        const replySummary = page.replyCount === 1
          ? '1 reply'
          : `${page.replyCount.toLocaleString('en-US')} replies`;
        const image = `${url.origin}/t/${params.did}/${params.rkey}/og.png`;
        const authorUrl = `${url.origin}/members/${encodeURIComponent(authorHandle)}`;
        return {
          title,
          description: opening || `Started by ${authorName} · ${replySummary}`,
          image,
          imageAlt: `${title} — a discussion started by ${authorName}`,
          type: 'article' as const,
          noindex: false,
          publishedTime: page.thread.value.createdAt,
          modifiedTime: page.thread.value.editedAt,
          authorUrl,
          structuredData: {
            '@type': 'DiscussionForumPosting',
            headline: title,
            ...(page.thread.value.createdAt ? { datePublished: page.thread.value.createdAt } : {}),
            ...(page.thread.value.editedAt ? { dateModified: page.thread.value.editedAt } : {}),
            author: {
              '@type': 'Person',
              name: authorName,
              url: authorUrl,
            },
            commentCount: page.replyCount,
            image,
          },
        };
      })()
    : undefined;
  // ?edit=<rkey> reopens one of the viewer's own posts in place. Anyone
  // else's rkey is ignored rather than erroring.
  const editRkey = url.searchParams.get('edit');
  let editing: { uri: string; title?: string; doc: ReturnType<typeof blocksToDoc> } | null = null;
  if (editRkey && locals.user && page.thread) {
    if (editRkey === params.rkey && page.thread.author === locals.user.did) {
      editing = { uri, title: page.thread.value.title, doc: blocksToDoc(page.thread.value.body) };
    } else {
      const reply = page.replies.find((r) => r.uri.endsWith(`/${editRkey}`) && r.author === locals.user!.did);
      if (reply) editing = { uri: reply.uri, doc: blocksToDoc(reply.value.body) };
    }
  }
  return {
    editing,
    replyTo,
    composerDoc,
    metadata,
    threadUri: uri,
    fresh,
    waiting,
    boardName,
    canModerate: page.thread ? await canModerate(locals.user?.did, page.thread.value.board) : false,
    handles,
    presence,
    ranks: forum.ranks ?? [],
    limit: LIMIT,
    offset: Number(cursor ?? 0),
    ...page,
  };
};

export const actions: Actions = {
  reply: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to reply.' });

    const form = await request.formData();
    const body = String(form.get('body') ?? '').trim();
    const images = String(form.get('body__images') ?? '');
    const threadCid = String(form.get('threadCid') ?? '');
    const parentUri = String(form.get('parentUri') ?? '');
    const parentCid = String(form.get('parentCid') ?? '');
    if (!body) return fail(400, { message: 'Write a reply before posting.' });

    // A locked thread takes no more replies from members. Staff may still
    // add a closing word, matching what the appview shows after the lock.
    const uri = threadUri(params.did, params.rkey);
    const { thread } = await getThreadPage(uri, { limit: 1 });
    if (thread?.locked && !(await canModerate(locals.user.did, thread.value.board))) {
      return fail(403, { message: 'This thread is locked.' });
    }
    const ban = thread ? await bannedFrom(locals.user.did, thread.value.board) : undefined;
    if (ban) return fail(403, { message: banMessage(ban) });

    try {
      await createReply(locals.user.did, {
        thread: { uri, cid: threadCid },
        ...(parentUri && parentCid && parentUri !== uri ? { parent: { uri: parentUri, cid: parentCid } } : {}),
        body: await addMentionFacets(attachImages(parseBBCode(body), images)),
      });
      return { posted: true };
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t post your reply. Try again.' });
    }
  },

  // Save an edit to one of your own posts, then hold the redirect until the
  // index has the new version so the page doesn't show the old body.
  edit: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to edit.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const title = form.has('title') ? String(form.get('title') ?? '').trim() : undefined;
    const body = String(form.get('body') ?? '').trim();
    const images = String(form.get('body__images') ?? '');
    if (title !== undefined && !title) return fail(400, { message: 'Enter a title for your thread.' });
    if (title === undefined && !body) return fail(400, { message: 'Write something, or delete the post instead.' });
    let editedAt: string;
    try {
      ({ editedAt } = await updatePost(locals.user.did, uri, {
        title,
        body: await addMentionFacets(attachImages(parseBBCode(body), images)),
      }));
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save your changes. Try again.' });
    }
    const threadRef = threadUri(params.did, params.rkey);
    const isThread = uri === threadRef;
    await savedRedirect(
      `/t/${params.did}/${params.rkey}?saved=1#${postAnchor(uri)}`,
      () => getThreadPage(threadRef, { limit: 1, reply: isThread ? undefined : uri }),
      (p) => {
        if (isThread) return p.thread?.value.editedAt === editedAt;
        return p.replies.some((r) => r.uri === uri && r.value.editedAt === editedAt);
      },
    );
  },

  // Delete one of your own posts. A deleted thread takes its page with it;
  // replies from others stay in their repos, unlisted.
  delete: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to delete.' });
    const form = await request.formData();
    const uri = String(form.get('uri') ?? '');
    const threadRef = threadUri(params.did, params.rkey);
    const { thread } = await getThreadPage(threadRef, { limit: 1 });
    try {
      await deletePost(locals.user.did, uri);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t delete this post. Try again.' });
    }
    if (uri === threadRef) {
      await savedRedirect(
        thread ? `${boardPath(thread.value.board, FORUM_DID())}?deleted=1` : '/',
        () => getThreadPage(threadRef, { limit: 1 }),
        (p) => !p.thread,
      );
    }
    await savedRedirect(
      `/t/${params.did}/${params.rkey}?deleted=1`,
      () => getThreadPage(threadRef, { limit: 1, reply: uri }),
      (p) => p.replyIndex === undefined,
    );
  },

  // Vote in the thread's poll: one record per chosen option. Changing a vote
  // retracts what's no longer chosen and casts what's new; the page then
  // polls the index until the tally reflects it.
  vote: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to vote.' });
    const form = await request.formData();
    const chosen = [...new Set(form.getAll('option').map(Number).filter(Number.isInteger))];
    const uri = threadUri(params.did, params.rkey);
    const page = await getThreadPage(uri, { limit: 1, viewer: locals.user.did });
    const poll = page.thread?.value.poll;
    if (!poll || !page.thread?.cid) return fail(400, { message: 'This thread has no poll.' });
    if (pollClosed(poll)) return fail(400, { message: 'This poll has closed.' });
    const ban = await bannedFrom(locals.user.did, page.thread.value.board);
    if (ban) return fail(403, { message: banMessage(ban) });
    if (!chosen.length) return fail(400, { message: 'Pick an option first.' });
    if (!poll.multipleChoice && chosen.length > 1) return fail(400, { message: 'This poll takes one choice.' });
    if (chosen.some((o) => o < 0 || o >= poll.options.length)) return fail(400, { message: 'Pick an option from the list.' });
    const have = page.poll?.viewerVotes ?? [];
    try {
      for (const v of have) if (!chosen.includes(v.option)) await retractVote(locals.user.did, v.uri);
      for (const o of chosen) {
        if (!have.some((v) => v.option === o)) await castVote(locals.user.did, { uri, cid: page.thread.cid }, o);
      }
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save your vote. Try again.' });
    }
    return { voted: true, options: chosen };
  },

  retract: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to vote.' });
    await request.formData();
    const uri = threadUri(params.did, params.rkey);
    const page = await getThreadPage(uri, { limit: 1, viewer: locals.user.did });
    if (page.thread?.value.poll && pollClosed(page.thread.value.poll)) return fail(400, { message: 'This poll has closed.' });
    try {
      for (const v of page.poll?.viewerVotes ?? []) await retractVote(locals.user.did, v.uri);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t retract your vote. Try again.' });
    }
    return { voted: true, options: [] as number[] };
  },

  // Staff: flip one of the thread's flags, then hold the redirect until the
  // index shows it, so the page never lands on a stale state.
  moderate: async ({ params, request, locals }) => {
    const form = await request.formData();
    const action = String(form.get('action') ?? '');
    if (!isThreadAction(action)) return fail(400, { message: 'Unknown moderation action.' });
    const uri = threadUri(params.did, params.rkey);
    const { thread } = await getThreadPage(uri, { limit: 1 });
    if (!thread) return fail(404, { message: 'Thread not found.' });
    if (!(await boardModerator(locals, thread.value.board))) {
      return fail(403, { message: 'Only staff for this board can moderate threads.' });
    }
    if (thread.origin && action !== 'hide' && action !== 'unhide') {
      return fail(400, { message: "Only a thread's own forum can lock or pin it." });
    }
    try {
      await createForumRecord(`${NS}.moderation.action`, {
        subject: { $type: 'com.atproto.repo.strongRef', uri, cid: thread.cid },
        action,
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t moderate this thread. Try again.' });
    }
    const flag = { hide: 'hidden', lock: 'locked', pin: 'pinned' }[actionFamily(action)] as 'hidden' | 'locked' | 'pinned';
    const want = !action.startsWith('un');
    await savedRedirect(
      `/t/${params.did}/${params.rkey}?moderated=1`,
      () => getThreadPage(uri, { limit: 1 }),
      (p) => p.thread?.[flag] === want,
    );
  },
};
