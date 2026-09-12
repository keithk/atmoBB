import { parseDidKey } from '@atproto/crypto';
import { mintSenderJwt } from './sender';

// The atmo.pub relay: outbound calls as the forum (send) and as a member
// (requestPermission), plus the relay's own signing key for verifying
// callbacks. The relay is a constant, not a setting; a different relay means
// editing the consent scope in atproto-oauth.ts too, which keeps its own copy.
export const RELAY_DID = 'did:web:relay.atmo.pub';
export const RELAY_AUD = `${RELAY_DID}#notif_relay`;

export const relayUrl = () => `https://${RELAY_DID.slice('did:web:'.length)}`;

const TIMEOUT_MS = 5000;
const KEY_CACHE_MS = 5 * 60_000;
const FORCE_REFRESH_MIN_MS = 30_000;

let fetchImpl: typeof fetch = (...args) => fetch(...args);

export function setFetchForTests(fn: typeof fetch) {
  fetchImpl = fn;
}

export function resetRelayForTests() {
  fetchImpl = (...args) => fetch(...args);
  cachedKey = null;
  inflight = null;
  lastForcedAt = 0;
}

async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface SendInput {
  recipient: string;
  title: string;
  body: string;
  uri?: string;
  category?: string;
  categoryDescription?: string;
  threadKey?: string;
  // pub.atmo.notify.send#actor: the people behind the alert, for the avatar stack.
  actors?: { did: string; handle?: string }[];
}

export interface SendResult {
  ok: boolean;
  // 0 when the relay never answered (network error or timeout).
  status: number;
  error?: string;
  delivered?: number;
}

// One attempt, timeout-bounded, never throws: dispatch runs after the
// response and only records the outcome.
export async function send(input: SendInput): Promise<SendResult> {
  try {
    const token = await mintSenderJwt('pub.atmo.notify.send', { aud: RELAY_AUD });
    const res = await fetchImpl(`${relayUrl()}/xrpc/pub.atmo.notify.send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readJsonBody(res);
    if (res.ok) {
      return { ok: true, status: res.status, delivered: typeof body.delivered === 'number' ? body.delivered : undefined };
    }
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) console.warn(`[notify] relay answered ${res.status} with Retry-After ${retryAfter} (not honored)`);
    return { ok: false, status: res.status, error: typeof body.error === 'string' ? body.error : undefined };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PermissionInput {
  senderDid: string;
  title: string;
  description?: string;
  iconUrl?: string;
}

export type PermissionResult = { status: 'pending' | 'alreadyGranted' } | { error: string; status: number };

// Called with the member's own service token for the relay, so the grant is
// theirs to give.
export async function requestPermission(userToken: string, input: PermissionInput): Promise<PermissionResult> {
  try {
    const res = await fetchImpl(`${relayUrl()}/xrpc/pub.atmo.notify.requestPermission`, {
      method: 'POST',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readJsonBody(res);
    if (!res.ok) {
      return { error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`, status: res.status };
    }
    if (body.status === 'pending' || body.status === 'alreadyGranted') return { status: body.status };
    return { error: 'UnexpectedResponse', status: res.status };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), status: 0 };
  }
}

let cachedKey: { didKey: string; fetchedAt: number } | null = null;
let inflight: Promise<string> | null = null;
let lastForcedAt = 0;

async function fetchRelayKey(): Promise<string> {
  const res = await fetchImpl(`${relayUrl()}/.well-known/did.json`, {
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Relay DID document returned ${res.status}`);
  const doc = await readJsonBody(res);
  const methods = Array.isArray(doc.verificationMethod) ? (doc.verificationMethod as unknown[]) : [];
  const method = methods.find(
    (m): m is { id: string; publicKeyMultibase: string } =>
      !!m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string' && (m as { id: string }).id.endsWith('#atproto'),
  );
  if (!method || typeof method.publicKeyMultibase !== 'string') {
    throw new Error('Relay DID document has no #atproto verification method');
  }
  const didKey = `did:key:${method.publicKeyMultibase}`;
  parseDidKey(didKey); // throws when the multibase is not a key we can verify with
  return didKey;
}

// The relay's did:key, cached five minutes. A forced refresh (after a
// signature failure) is honored at most once per 30 seconds of wall clock, so
// a flood of garbage tokens cannot turn the webhook into an outbound fetcher.
// When a refetch fails and an older key is on hand, that key is served: a
// stale key still verifies real callbacks, and a rejection would turn a relay
// blip into a dropped callback.
export function relaySigningKey(forceRefresh = false): Promise<string> {
  const now = Date.now();
  const stale = !cachedKey || now - cachedKey.fetchedAt >= KEY_CACHE_MS;
  const mayForce = forceRefresh && now - lastForcedAt >= FORCE_REFRESH_MIN_MS;
  if (cachedKey && !stale && !mayForce) return Promise.resolve(cachedKey.didKey);
  if (inflight) return inflight;
  if (mayForce) lastForcedAt = now;
  const previous = cachedKey;
  inflight = fetchRelayKey()
    .then((didKey) => {
      cachedKey = { didKey, fetchedAt: now };
      return didKey;
    })
    .catch((err) => {
      if (!previous) throw err;
      console.warn('[notify] could not refresh the relay signing key; using the cached one', err);
      return previous.didKey;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
