import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  boardUri,
  FORUM_DID,
  getBoardThreads,
  spaceUriFor,
  isSpaceMember,
  THREAD_NSID,
  resolveHandle,
} from '$lib/server/appview';
import { readSpaceThreadPage } from '$lib/server/space-read';
import { createReply, deletePost, updatePost } from '$lib/server/pds';
import { blocksToDoc } from '$lib/richtext/blocks-tiptap';
import { blocksToPlainText } from '$lib/richtext/plain';
import { postAuthor } from '$lib/appview-paths';
import { presenceFor } from '$lib/server/profiles';
import { parseBBCode } from '$lib/richtext/bbcode';
import { attachImages, resolveBodyImages } from '$lib/server/richtext';
import { addMentionFacets } from '$lib/server/mentions';
import { banMessage, bannedFrom } from '$lib/server/standing';

const QUOTE = 'app.atmobb.richtext.block#quote';
const LIMIT = 25;

function threadRef(params: { did?: string; rkey: string; adid: string; trkey: string }) {
  const forumDid = params.did ?? FORUM_DID();
  const space = spaceUriFor(params.rkey, forumDid);
  const uri = `${space}/${params.adid}/${THREAD_NSID}/${params.trkey}`;
  const boardPath = `/b/${params.did ? `${params.did}/` : ''}${params.rkey}`;
  return { space, uri, boardPath };
}

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  const { space, uri, boardPath } = threadRef(params);
  // Membership gates the whole page; non-members bounce to the locked board.
  if (!locals.user || !(await isSpaceMember(space, locals.user.did))) {
    redirect(303, boardPath);
  }
  const [page, boardName] = await Promise.all([
    readSpaceThreadPage(locals.user.did, uri),
    getBoardThreads(boardUri(params.rkey, params.did), undefined, 1)
      .then((boardPage) => boardPage.board?.name)
      .catch(() => undefined),
  ]);
  if (!page.thread) error(404, 'Thread not found.');
  await resolveBodyImages([
    { author: page.thread.author, body: page.thread.value.body },
    ...page.replies.map((r) => ({ author: r.author, body: r.value.body })),
    { author: page.thread.author, body: page.thread.authorProfile?.signature },
    ...page.replies.map((r) => ({ author: r.author, body: r.authorProfile?.signature })),
  ]);
  const { forum } = (await parent()) as { forum?: { ranks?: { title: string; minPosts: number }[] } };

  // ?to=<rkey> answers a post; ?quote=<rkey> answers it with its text quoted.
  const posts = [
    { uri, cid: page.thread.cid, author: page.thread.author, body: page.thread.value.body },
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

  const authors = [
    ...posts.map((p) => p.author),
    ...page.replies.flatMap((r) => (r.value.parent ? [postAuthor(r.value.parent.uri)] : [])),
    ...posts.flatMap((p) => (p.body ?? []).flatMap((b) => (b.subject ? [postAuthor(b.subject.uri)] : []))),
  ];
  const uniqueAuthors = [...new Set(authors)];
  const handles = Object.fromEntries(
    await Promise.all(uniqueAuthors.map(async (d) => [d, await resolveHandle(d)] as const)),
  );
  const presence = Object.fromEntries(uniqueAuthors.map((d) => [d, presenceFor(d)]));

  // ?edit=<rkey> reopens one of the viewer's own posts in place.
  const editRkey = url.searchParams.get('edit');
  let editing: { uri: string; title?: string; doc: ReturnType<typeof blocksToDoc> } | null = null;
  if (editRkey) {
    if (editRkey === params.trkey && page.thread.author === locals.user.did) {
      editing = { uri, title: page.thread.value.title, doc: blocksToDoc(page.thread.value.body) };
    } else {
      const reply = page.replies.find((r) => r.uri.endsWith(`/${editRkey}`) && r.author === locals.user!.did);
      if (reply) editing = { uri: reply.uri, doc: blocksToDoc(reply.value.body) };
    }
  }
  return {
    metadata: {
      title: page.thread.value.title,
      description: 'A members-only discussion.',
      type: 'article' as const,
      noindex: true,
      canonical: `${boardPath}/t/${params.adid}/${params.trkey}`,
    },
    editing,
    replyTo,
    composerDoc,
    threadUri: uri,
    boardPath,
    boardName,
    handles,
    presence,
    ranks: forum?.ranks ?? [],
    limit: LIMIT,
    offset: 0,
    ...page,
  };
};

export const actions: Actions = {
  reply: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to reply.' });
    const { space, uri } = threadRef(params);
    if (!(await isSpaceMember(space, locals.user.did))) {
      return fail(403, { message: 'Only members of this board can reply.' });
    }
    // Strict: space reads never consult the index, so a ban the appview
    // couldn't confirm has nothing else to catch it.
    let ban;
    try {
      ban = await bannedFrom(locals.user.did, boardUri(params.rkey, params.did), { strict: true });
    } catch {
      return fail(502, { message: "We couldn't check your standing. Try again." });
    }
    if (ban) return fail(403, { message: banMessage(ban) });
    const form = await request.formData();
    const body = String(form.get('body') ?? '').trim();
    const images = String(form.get('body__images') ?? '');
    const threadCid = String(form.get('threadCid') ?? '');
    const parentUri = String(form.get('parentUri') ?? '');
    const parentCid = String(form.get('parentCid') ?? '');
    if (!body) return fail(400, { message: 'Write a reply before posting.' });
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

  // Space reads are direct, so edits and deletes land immediately: no
  // waiting on the index as the public thread page does.
  edit: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to edit.' });
    const form = await request.formData();
    const target = String(form.get('uri') ?? '');
    const title = form.has('title') ? String(form.get('title') ?? '').trim() : undefined;
    const body = String(form.get('body') ?? '').trim();
    const images = String(form.get('body__images') ?? '');
    if (title !== undefined && !title) return fail(400, { message: 'Enter a title for your thread.' });
    if (title === undefined && !body) return fail(400, { message: 'Write something, or delete the post instead.' });
    try {
      await updatePost(locals.user.did, target, {
        title,
        body: await addMentionFacets(attachImages(parseBBCode(body), images)),
      });
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t save your changes. Try again.' });
    }
    const { boardPath } = threadRef(params);
    redirect(303, `${boardPath}/t/${params.adid}/${params.trkey}?saved=1#post-${target.split('/').pop()}`);
  },

  delete: async ({ params, request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Log in to delete.' });
    const form = await request.formData();
    const target = String(form.get('uri') ?? '');
    const { uri, boardPath } = threadRef(params);
    try {
      await deletePost(locals.user.did, target);
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : 'We couldn\'t delete this post. Try again.' });
    }
    redirect(303, target === uri ? `${boardPath}?deleted=1` : `${boardPath}/t/${params.adid}/${params.trkey}?deleted=1`);
  },
};
