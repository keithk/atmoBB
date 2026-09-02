import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Agent } from '@atproto/api';
import { oauthClient } from '$lib/server/atproto-oauth';
import { setSessionCookie } from '$lib/server/session';
import { FORUM_DID } from '$lib/server/appview';
import { invalidateForumSession, invalidateStaff } from '$lib/server/admin';

const NS = 'app.atmobb';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const { session, state } = await oauthClient().callback(url.searchParams);

  // The connect-forum flow authorizes the FORUM account (state carries the
  // sysop who started it). It must not become the browser's login; it just
  // parks the session in the store for agentFor(forumDid) writes.
  if (state?.startsWith('forum-connect:')) {
    if (session.did !== FORUM_DID()) {
      try {
        await oauthClient().revoke(session.did);
      } catch {
        // best effort; an unused stray session is harmless
      }
      redirect(303, '/admin/connect?error=wrong-account');
    }
    const connector = state.slice('forum-connect:'.length);
    const agent = new Agent(session);
    // Bootstrap: whoever connected the forum account controls it — make
    // their personal DID an admin, unless a grant already exists.
    const existing = await agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection: `${NS}.forum.moderator`,
      limit: 100,
    });
    const already = existing.data.records.some(
      (r) => (r.value as { subject?: string }).subject === connector,
    );
    if (!already && connector.startsWith('did:')) {
      await agent.com.atproto.repo.createRecord({
        repo: session.did,
        collection: `${NS}.forum.moderator`,
        record: {
          $type: `${NS}.forum.moderator`,
          subject: connector,
          role: 'admin',
          createdAt: new Date().toISOString(),
        },
      });
    }
    invalidateForumSession();
    invalidateStaff();
    redirect(303, '/admin?connected=1');
  }

  setSessionCookie(cookies, session.did);
  redirect(303, '/');
};
