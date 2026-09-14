import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { MAX_ACTION_NAME_LENGTH } from '$lib/extensions/bridge';
import { bindingAccess, bindingFor, type BindingAccess } from '$lib/server/extensions/bindings';
import { ExtensionCallError, ExtensionRefusal, dispatchAction, type ExtensionCallErrorCode } from '$lib/server/extensions/host';
import { extensionsLockHeld } from '$lib/server/extensions/lock';
import { extensionsEnabled } from '$lib/server/extensions/manifest';
import { banMessage, bannedFrom } from '$lib/server/standing';

// A panel's action, forwarded by the forum page it's shown on:
// POST { thread: <at-uri> | null, action, input }. The viewer is whoever the
// session says, never anything in the body. SvelteKit's own CSRF check covers
// form posts only, so this takes JSON alone and requires the forum's own
// origin. Everything travels in the body, since the proxy logs URLs.
//
// An action from a thread needs a signed-in viewer, a thread bound to this
// install, and that thread still visible on a public board. Signed-out
// visitors may act only on the extension's standalone page, counted by client
// address. adapter-node reports that address from the socket unless
// ADDRESS_HEADER and XFF_DEPTH say which proxy header to trust, so a
// deployment behind Caddy must set them or every visitor shares one count.

const NO_STORE = { 'cache-control': 'private, no-store' };

const refuse = (status: number, code: string, message: string) => json({ code, message }, { status, headers: NO_STORE });

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const ACCESS_STATUS: Record<Exclude<BindingAccess, { ok: true }>['reason'], number> = {
  missing: 404,
  hidden: 403,
  elsewhere: 403,
  'members-only': 403,
  unavailable: 502,
};

const CALL_STATUS: Record<ExtensionCallErrorCode, number> = {
  unavailable: 503,
  not_installed: 404,
  disabled: 404,
  rate_limited: 429,
  sign_in_required: 401,
  no_handler: 404,
  timeout: 502,
  memory: 502,
  call_limit: 502,
  failed: 502,
  bad_output: 502,
};

export const POST: RequestHandler = async ({ request, params, locals, getClientAddress }) => {
  const origin = env.ATMOBB_APP_URL ? new URL(env.ATMOBB_APP_URL).origin : null;
  if (!origin || request.headers.get('origin') !== origin) return refuse(403, 'bad_origin', 'Actions must come from this forum.');
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return refuse(415, 'bad_request', 'Send the action as JSON.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, 'bad_request', "The action isn't valid JSON.");
  }
  if (!isObject(body) || !(typeof body.thread === 'string' || body.thread === null)) return refuse(400, 'bad_request', 'The action needs a thread at-uri or null.');
  const { thread, action, input = null } = body;
  if (typeof action !== 'string' || !action || action.length > MAX_ACTION_NAME_LENGTH) return refuse(400, 'bad_request', 'The action needs a name.');

  if (!extensionsEnabled() || !extensionsLockHeld()) return refuse(503, 'unavailable', "Extensions aren't running on this forum right now.");

  const viewerDid = locals.user?.did ?? null;
  let board: string | undefined;
  if (thread !== null) {
    if (!viewerDid) return refuse(401, 'sign_in_required', 'Sign in to use this extension on a thread.');
    const binding = await bindingFor(thread);
    if (binding?.installId !== params.install) return refuse(404, 'not_attached', "This extension isn't attached to that thread.");
    const access = await bindingAccess(thread);
    if (!access.ok) return refuse(ACCESS_STATUS[access.reason], access.reason, access.message);
    board = access.board;
  }

  let client: string | undefined;
  if (viewerDid) {
    const ban = await bannedFrom(viewerDid, board, { strict: true }).catch(() => null);
    if (ban === null) return refuse(502, 'unavailable', "Couldn't check your standing right now. Try again in a minute.");
    if (ban) return refuse(403, 'banned', banMessage(ban));
  } else {
    try {
      client = getClientAddress();
    } catch {
      return refuse(400, 'bad_request', "Couldn't tell where this request came from.");
    }
  }

  try {
    const value = await dispatchAction(params.install, viewerDid, thread === null ? null : { uri: thread }, action, input, client ? { client } : {});
    return json({ value }, { headers: NO_STORE });
  } catch (error) {
    // A refusal is the extension's message for this viewer; it is shown to them and never logged.
    if (error instanceof ExtensionRefusal) return refuse(422, error.code, error.message);
    // Host errors carry no guest text, so their messages are safe to show.
    if (error instanceof ExtensionCallError) return refuse(CALL_STATUS[error.code] ?? 502, error.code, error.message);
    console.error(`[extensions] action for ${params.install} failed:`, error instanceof Error ? error.message : error);
    return refuse(500, 'failed', 'Something went wrong running that action.');
  }
};
