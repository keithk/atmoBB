import type { RequestHandler } from './$types';
import { renderPng, pngResponse } from '$lib/server/og/render';
import { threadCard, genericCard } from '$lib/server/og/cards';
import { getThreadPage, threadUri, getBoardIndex, resolveHandle, FORUM_DID } from '$lib/server/appview';
import { profileAvatarNode } from '$lib/server/og/avatar';
import { rankFor } from '$lib/rank';
import { relTime } from '$lib/reltime';

export const GET: RequestHandler = async ({ params, url, fetch }) => {
  const uri = threadUri(params.did, params.rkey);
  try {
    const [page, index] = await Promise.all([getThreadPage(uri), getBoardIndex(FORUM_DID())]);
    const thread = page.thread;
    if (!thread) throw new Error('thread not indexed');

    const board = index.boards?.find((b) => b.uri === thread.value.board);
    const category = board?.value.category
      ? index.categories?.find((c) => c.uri === board.value.category)
      : undefined;
    const boardPath = board
      ? category
        ? `${category.value.name} › ${board.value.name}`
        : board.value.name
      : 'Thread';

    const handle = await resolveHandle(thread.author);
    const authorHandle = handle.startsWith('did:') ? thread.author.slice(8, 20) : handle;
    const avatar = await profileAvatarNode(
      thread.authorProfile,
      thread.author,
      fetch,
      { size: 110, radius: 14 },
      thread.authorProfile?.displayName ?? authorHandle,
    );
    const rank = rankFor(index.forum?.ranks ?? [], thread.authorPosts).title;

    const png = await renderPng(
      threadCard({
        boardPath,
        title: thread.value.title,
        authorHandle,
        avatar,
        rank: rank || undefined,
        replies: page.replyCount,
        started: relTime(thread.value.createdAt).replace(' ago', '') || undefined,
      }),
    );
    return pngResponse(png, 300);
  } catch {
    const png = await renderPng(genericCard({ host: url.host }));
    return pngResponse(png, 60);
  }
};
