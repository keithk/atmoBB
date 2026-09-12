import { RELAY_DID, relaySigningKey } from './relay';
import { senderDid } from './sender';
import { ServiceJwtError, verifyServiceJwt } from './service-jwt';
import { applyCallback } from './store';

// The relay's subscriberChanged callback: a member granted or revoked this
// forum on atmo.pub. Checks run in the order token, then body, so an
// unauthenticated caller learns nothing about what a valid body looks like.
// The token is never logged.

const LXM = 'pub.atmo.notify.subscriberChanged';
const MAX_BODY_BYTES = 8 * 1024;

const reply = (status: number, body: unknown) => Response.json(body, { status });

// Reads at most `limit` bytes; null means the body was larger. The declared
// length is checked first so an honest oversized client is refused before
// anything streams.
async function readBounded(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface Callback {
  recipient: string;
  enabled: boolean;
  changedAt?: string;
}

function parseCallback(text: string): Callback | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { recipient, enabled, changedAt } = parsed as Record<string, unknown>;
  if (typeof recipient !== 'string' || !recipient.startsWith('did:')) return null;
  if (typeof enabled !== 'boolean') return null;
  if (changedAt !== undefined && typeof changedAt !== 'string') return null;
  return { recipient, enabled, changedAt };
}

export async function handleSubscriberChanged(request: Request): Promise<Response> {
  const did = senderDid();
  if (!did) return reply(404, { error: 'NotFound', message: 'This forum has no sender identity' });

  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) return reply(401, { error: 'AuthMissing' });
  try {
    await verifyServiceJwt(token, {
      aud: [did, `${did}#atmobb_sender`],
      lxm: LXM,
      iss: RELAY_DID,
      // The issuer is already pinned to the relay above, so only the refresh
      // flag is forwarded.
      resolveKey: (_iss, forceRefresh) => relaySigningKey(forceRefresh),
    });
  } catch (err) {
    if (err instanceof ServiceJwtError && err.reason === 'issuer') return reply(403, { error: 'Forbidden', message: err.message });
    return reply(401, { error: 'AuthInvalid', message: err instanceof Error ? err.message : 'Bad token' });
  }

  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
    return reply(400, { error: 'InvalidRequest', message: 'Expected application/json' });
  }
  const text = await readBounded(request, MAX_BODY_BYTES);
  if (text === null) return reply(400, { error: 'InvalidRequest', message: 'Body too large' });
  const callback = parseCallback(text);
  if (!callback) return reply(400, { error: 'InvalidRequest', message: 'Expected { recipient, enabled, changedAt? }' });

  try {
    await applyCallback(callback.recipient, callback.enabled, callback.changedAt);
  } catch (err) {
    // 500 so the relay retries; the member's file is the only record of the grant.
    console.error('[notify] subscriberChanged: could not write member state', err);
    return reply(500, { error: 'InternalError' });
  }
  return reply(200, { ok: true });
}
