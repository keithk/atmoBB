import { json } from '@sveltejs/kit';
import { isValidDid } from '@atproto/syntax';
import type { RequestHandler } from './$types';
import { MAX_NAME_DIDS, MAX_NAME_HANDLES } from '$lib/extensions/bridge';
import { extensionsLockHeld } from '$lib/server/extensions/lock';
import { extensionsEnabled } from '$lib/server/extensions/manifest';
import { lookupNames, normalizeHandle, takeNameLookup } from '$lib/server/extensions/names';
import { getInstall } from '$lib/server/extensions/registry';

// Who the people in a panel are: GET ?did=<did>&did=…&handle=<handle>&…
// answers { names: { <did>: { handle, displayName? } | null },
// dids: { <handle>: <did> | null } }, keyed exactly as asked, for the page to
// hand the panel over the bridge. A handle counts only when it resolves back
// to the DID; anything unverified, unreadable, or too slow answers null.
//
// Like source lookups, an answer is cached only in the viewer's browser (a
// minute) and never by a shared cache, which would skip the per-client count
// and keep answering for a disabled install. An answer with any null in it
// isn't cached at all, so the next load tries again.
//
// Lookups are counted per install and client address. adapter-node reports
// that address from the socket unless ADDRESS_HEADER and XFF_DEPTH say which
// proxy header to trust, so a deployment behind Caddy must set them or every
// visitor shares one count.

const NO_STORE = { 'cache-control': 'private, no-store' };

const refuse = (status: number, code: string, message: string) => json({ code, message }, { status, headers: NO_STORE });

export const GET: RequestHandler = async ({ params, url, getClientAddress }) => {
  if (!extensionsEnabled() || !extensionsLockHeld()) return refuse(503, 'unavailable', "Extensions aren't running on this forum right now.");
  const install = await getInstall(params.install);
  if (install?.state !== 'active') return refuse(404, 'not_installed', "This extension isn't installed here.");

  const dids = url.searchParams.getAll('did');
  const handles = url.searchParams.getAll('handle');
  if (!dids.length && !handles.length) return refuse(400, 'bad_request', 'Name at least one DID or handle.');
  if (dids.length > MAX_NAME_DIDS || handles.length > MAX_NAME_HANDLES) {
    return refuse(400, 'bad_request', `Ask about at most ${MAX_NAME_DIDS} DIDs and ${MAX_NAME_HANDLES} handles at once.`);
  }
  if (!dids.every((did) => isValidDid(did))) return refuse(400, 'bad_request', 'Name each person as a DID.');
  if (!handles.every((handle) => normalizeHandle(handle))) return refuse(400, 'bad_request', 'Name each handle as a handle, with or without @.');

  let client: string;
  try {
    client = getClientAddress();
  } catch {
    return refuse(400, 'bad_request', "Couldn't tell where this request came from.");
  }
  if (!takeNameLookup(params.install, client)) return refuse(429, 'rate_limited', 'Too many name lookups; try again in a minute.');

  const answer = await lookupNames(dids, handles);
  const complete = [...Object.values(answer.names), ...Object.values(answer.dids)].every((entry) => entry !== null);
  return json(answer, { headers: complete ? { 'cache-control': 'private, max-age=60' } : NO_STORE });
};
