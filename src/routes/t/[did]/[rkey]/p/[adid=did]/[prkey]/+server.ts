import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getThreadPage, replyUri, threadUri } from '$lib/server/appview';
import { postAnchor, THREAD_PAGE_SIZE } from '$lib/appview-paths';

// Permalink to one reply: find which page it's on and land there, scrolled
// to the post. Pages are offset-based, so a deleted earlier reply can shift a
// post between pages; resolving at click time keeps old links working.
export const GET: RequestHandler = async ({ params }) => {
  const reply = replyUri(params.adid, params.prkey);
  const page = await getThreadPage(threadUri(params.did, params.rkey), { limit: THREAD_PAGE_SIZE, reply });
  if (page.replyIndex === undefined) error(404, 'That reply is not in this thread.');
  const offset = Math.floor(page.replyIndex / THREAD_PAGE_SIZE) * THREAD_PAGE_SIZE;
  const query = offset ? `?cursor=${offset}` : '';
  redirect(302, `/t/${params.did}/${params.rkey}${query}#${postAnchor(reply)}`);
};
