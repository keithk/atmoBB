import { P256Keypair } from '@atproto/crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_DID, relaySigningKey, resetRelayForTests, setFetchForTests } from './relay';
import { mintServiceJwt, verifyServiceJwt } from './service-jwt';

const iss = 'did:web:relay.example';
const aud = 'did:web:forum.example.net';
const lxm = 'pub.atmo.notify.subscriberChanged';

let keypair: P256Keypair;
let other: P256Keypair;

beforeAll(async () => {
  keypair = await P256Keypair.create();
  other = await P256Keypair.create();
});

const resolveKey = async () => keypair.did();
const expected = () => ({ aud, lxm, iss, resolveKey });

const b64url = (s: string) => Buffer.from(s).toString('base64url');
const decodePart = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('mintServiceJwt and verifyServiceJwt', () => {
  it('round-trips a token and returns its claims', async () => {
    const token = await mintServiceJwt(keypair, { iss, aud, lxm });
    const payload = await verifyServiceJwt(token, expected());
    expect(payload.lxm).toBe(lxm);
    expect(payload.aud).toBe(aud);
    expect(payload.iss).toBe(iss);
    expect(payload.exp).toBe(payload.iat + 60);
  });

  it('accepts any of several audiences', async () => {
    const token = await mintServiceJwt(keypair, { iss, aud: `${aud}#atmobb_sender`, lxm });
    await expect(verifyServiceJwt(token, { ...expected(), aud: [aud, `${aud}#atmobb_sender`] })).resolves.toBeTruthy();
  });

  it('fails on signature when a payload byte is tampered', async () => {
    const [h, p, s] = (await mintServiceJwt(keypair, { iss, aud, lxm })).split('.');
    const claims = decodePart(p);
    claims.jti = `${claims.jti}x`;
    const tampered = `${h}.${b64url(JSON.stringify(claims))}.${s}`;
    await expect(verifyServiceJwt(tampered, expected())).rejects.toThrow(/signature/i);
  });

  it('rejects a token that expired ten seconds ago but allows two seconds of clock skew', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await mintServiceJwt(keypair, { iss, aud, lxm, expiresInSeconds: -10 });
    await expect(verifyServiceJwt(expired, expected())).rejects.toThrow(/expired/i);
    const skewed = await mintServiceJwt(keypair, { iss, aud, lxm, expiresInSeconds: -2 });
    const payload = await verifyServiceJwt(skewed, expected());
    expect(payload.exp).toBeLessThanOrEqual(now);
  });

  it('fails with distinct reasons for wrong aud, lxm, and iss', async () => {
    const token = await mintServiceJwt(keypair, { iss, aud, lxm });
    const messages: string[] = [];
    for (const wrong of [
      { ...expected(), aud: 'did:web:someone.else' },
      { ...expected(), lxm: 'pub.atmo.notify.send' },
      { ...expected(), iss: 'did:web:not.the.relay' },
    ]) {
      await expect(verifyServiceJwt(token, wrong)).rejects.toThrow();
      await verifyServiceJwt(token, wrong).catch((err: Error) => messages.push(err.message));
    }
    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(3);
    expect(messages[0]).toMatch(/audience/i);
    expect(messages[1]).toMatch(/method/i);
    expect(messages[2]).toMatch(/issuer/i);
  });

  it('rejects malformed tokens and access-token types without calling the resolver', async () => {
    const resolver = vi.fn(resolveKey);
    await expect(verifyServiceJwt('not.a-jwt', { ...expected(), resolveKey: resolver })).rejects.toThrow(/malformed/i);
    const header = b64url(JSON.stringify({ typ: 'at+jwt', alg: 'ES256' }));
    const [, p, s] = (await mintServiceJwt(keypair, { iss, aud, lxm })).split('.');
    await expect(verifyServiceJwt(`${header}.${p}.${s}`, { ...expected(), resolveKey: resolver })).rejects.toThrow(/type/i);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('retries once with a forced refresh when the resolver first returns a stale key', async () => {
    const resolver = vi.fn(async (_iss: string, forceRefresh: boolean) => (forceRefresh ? keypair.did() : other.did()));
    const token = await mintServiceJwt(keypair, { iss, aud, lxm });
    const payload = await verifyServiceJwt(token, { ...expected(), resolveKey: resolver });
    expect(payload.lxm).toBe(lxm);
    expect(resolver.mock.calls.map(([, force]) => force)).toEqual([false, true]);
  });
});

describe('relaySigningKey', () => {
  let relayKey: P256Keypair;
  let fetchMock: ReturnType<typeof vi.fn>;

  const didDoc = (key: P256Keypair) => ({
    id: RELAY_DID,
    verificationMethod: [
      { id: `${RELAY_DID}#atproto`, type: 'Multikey', controller: RELAY_DID, publicKeyMultibase: key.did().slice('did:key:'.length) },
    ],
  });

  beforeEach(async () => {
    relayKey = await P256Keypair.create();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    fetchMock = vi.fn(async () => Response.json(didDoc(relayKey)));
    resetRelayForTests();
    setFetchForTests(fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    resetRelayForTests();
    vi.useRealTimers();
  });

  it('reads the #atproto key from the relay DID document, refusing redirects', async () => {
    expect(await relaySigningKey()).toBe(relayKey.did());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://relay.atmo.pub/.well-known/did.json');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('caches for five minutes and refetches after', async () => {
    await relaySigningKey();
    vi.setSystemTime(Date.now() + 4 * 60_000);
    await relaySigningKey();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await relaySigningKey();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors forceRefresh at most once per 30 seconds', async () => {
    await relaySigningKey();
    await relaySigningKey(true);
    await relaySigningKey(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 31_000);
    await relaySigningKey(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a document without a usable #atproto key', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: RELAY_DID, verificationMethod: [] }));
    await expect(relaySigningKey()).rejects.toThrow(/#atproto/);
    fetchMock.mockResolvedValueOnce(
      Response.json({ id: RELAY_DID, verificationMethod: [{ id: `${RELAY_DID}#atproto`, publicKeyMultibase: 'zNotAKey' }] }),
    );
    await expect(relaySigningKey()).rejects.toThrow();
  });

  it('turns ten bad-signature tokens within a second into exactly one forced refetch', async () => {
    const check = { aud, lxm, iss: RELAY_DID, resolveKey: (_iss: string, force: boolean) => relaySigningKey(force) };
    for (let i = 0; i < 10; i++) {
      const bad = await mintServiceJwt(other, { iss: RELAY_DID, aud, lxm });
      await expect(verifyServiceJwt(bad, check)).rejects.toThrow(/signature/i);
      vi.setSystemTime(Date.now() + 100);
    }
    // one initial fetch, one forced refetch, then the cache answers
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const good = await mintServiceJwt(relayKey, { iss: RELAY_DID, aud, lxm });
    await expect(verifyServiceJwt(good, check)).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
