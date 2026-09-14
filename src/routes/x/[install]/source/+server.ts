import { json } from '@sveltejs/kit';
import { isValidDid } from '@atproto/syntax';
import type { RequestHandler } from './$types';
import { extensionsLockHeld } from '$lib/server/extensions/lock';
import { extensionsEnabled } from '$lib/server/extensions/manifest';
import { getInstall } from '$lib/server/extensions/registry';
import { sourceIdentity, takeSourceLookup } from '$lib/server/extensions/source';

// Who a standalone page's records come from: GET ?did=<did> answers
// { did, handle, handleVerified, forum, forumName?, unavailable? }, which the
// page draws above the panel. A lookup that couldn't read the DID's identity
// or repo still answers 200, with `unavailable` set and `forum` false, so the
// page never labels an unchecked account a forum.
//
// The answer is the same for every viewer, but it's cached only in the
// viewer's browser (a minute, enough for a reload) and never by a shared
// cache: a shared hit would skip the per-client count, and would keep
// answering for an install that's since been disabled. An unavailable answer
// isn't cached at all, so the next load checks again.
//
// Lookups are counted per client address. adapter-node reports that address
// from the socket unless ADDRESS_HEADER and XFF_DEPTH say which proxy header
// to trust, so a deployment behind Caddy must set them or every visitor
// shares one count.

const NO_STORE = { 'cache-control': 'private, no-store' };

const refuse = (status: number, code: string, message: string) => json({ code, message }, { status, headers: NO_STORE });

export const GET: RequestHandler = async ({ params, url, getClientAddress }) => {
  if (!extensionsEnabled() || !extensionsLockHeld()) return refuse(503, 'unavailable', "Extensions aren't running on this forum right now.");
  const install = await getInstall(params.install);
  if (install?.state !== 'active') return refuse(404, 'not_installed', "This extension isn't installed here.");
  const did = url.searchParams.get('did');
  if (!isValidDid(did)) return refuse(400, 'bad_request', 'Name the source as a DID.');

  let client: string;
  try {
    client = getClientAddress();
  } catch {
    return refuse(400, 'bad_request', "Couldn't tell where this request came from.");
  }
  if (!takeSourceLookup(client)) return refuse(429, 'rate_limited', 'Too many source checks; try again in a minute.');

  const identity = await sourceIdentity(did);
  return json(identity, { headers: identity.unavailable ? NO_STORE : { 'cache-control': 'private, max-age=60' } });
};
