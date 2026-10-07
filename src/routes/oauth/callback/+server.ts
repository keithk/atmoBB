import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Agent } from '@atproto/api';
import { oauthClient } from '$lib/server/atproto-oauth';
import { sessionDid, setSessionCookie } from '$lib/server/session';
import { FORUM_DID } from '$lib/server/appview';
import { invalidateForumSession, invalidateStaff } from '$lib/server/admin';
import { safeReturnPath } from '$lib/server/notify/return-path';

const NS = 'app.atmobb';

export const GET: RequestHandler = async ({ url, cookies }) => {
  let result;
  try {
    result = await oauthClient().callback(url.searchParams, cookies, sessionDid(cookies));
  } catch {
    // Do not reflect upstream token bodies, callback codes, or SDK errors.
    error(400, 'Login could not be verified. Return to login or forum connect and start again.');
  }
  const { session, context } = result;

  // The wrapper checks browser, initiating personal user, issuer and account
  // before registration. Recheck context before granting forum administration.
  if (context.purpose === 'forum') {
    if (session.did !== FORUM_DID() || context.forumDid !== FORUM_DID()
      || context.connector !== sessionDid(cookies)) error(400, 'Forum connection context changed.');
    const connector = context.connector;
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
  const next = safeReturnPath(context.next);
  redirect(303, next ?? '/');
};
