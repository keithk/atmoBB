import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { P256Keypair } from '@atproto/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_AUD, RELAY_DID, relaySigningKey, requestPermission, resetRelayForTests, send, setFetchForTests } from './relay';
import { resetSenderForTests } from './sender';

const relayBase = 'https://relay.atmo.pub/xrpc';
const decodePart = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

let dataDir: string;
let fetchMock: ReturnType<typeof vi.fn>;

const lastRequest = () => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'atmobb-relay-'));
  process.env.DATA_DIR = dataDir;
  process.env.ATMOBB_APP_URL = 'https://forum.test';
  resetSenderForTests();
  resetRelayForTests();
  fetchMock = vi.fn();
  setFetchForTests(fetchMock as unknown as typeof fetch);
});

afterEach(async () => {
  resetRelayForTests();
  resetSenderForTests();
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.ATMOBB_APP_URL;
  vi.restoreAllMocks();
});

describe('send', () => {
  const input = { recipient: 'did:plc:alice', title: 'New reply', body: 'Bob replied', uri: 'https://forum.test/t/1', threadKey: 't1' };

  it('posts the alert to the relay as the forum with a sender JWT', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'n1', delivered: 0 }));
    const result = await send(input);
    expect(result).toEqual({ ok: true, status: 200, delivered: 0 });
    const { url, init, headers } = lastRequest();
    expect(url).toBe(`${relayBase}/pub.atmo.notify.send`);
    expect(init.method).toBe('POST');
    expect(headers['content-type']).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(headers.authorization).toMatch(/^Bearer /);
    const claims = decodePart(headers.authorization.slice('Bearer '.length).split('.')[1]);
    expect(claims).toMatchObject({ iss: 'did:web:forum.test', aud: RELAY_AUD, lxm: 'pub.atmo.notify.send' });
  });

  it('reports the relay error name on a 403', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'NotAuthorized' }, { status: 403 }));
    expect(await send(input)).toEqual({ ok: false, status: 403, error: 'NotAuthorized' });
  });

  it('logs Retry-After on a 429 and still reports the failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'RateLimited' }, { status: 429, headers: { 'retry-after': '30' } }));
    expect(await send(input)).toEqual({ ok: false, status: 429, error: 'RateLimited' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Retry-After 30'));
  });

  it('answers status 0 instead of throwing when the relay is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await send(input)).toEqual({ ok: false, status: 0, error: 'ECONNREFUSED' });
  });
});

describe('requestPermission', () => {
  const input = { senderDid: 'did:web:forum.test', title: 'Forum', description: 'Replies and mentions' };
  const userToken = 'user-service-token';

  it('sends the member token, not the sender JWT, and returns pending', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'pending' }));
    expect(await requestPermission(userToken, input)).toEqual({ status: 'pending' });
    const { url, init, headers } = lastRequest();
    expect(url).toBe(`${relayBase}/pub.atmo.notify.requestPermission`);
    expect(init.method).toBe('POST');
    expect(headers.authorization).toBe(`Bearer ${userToken}`);
    expect(JSON.parse(init.body as string)).toEqual(input);
    // No sender JWT was minted for the member's own call, so no sender key exists.
    expect(existsSync(join(dataDir, 'notify', 'sender-key.json'))).toBe(false);
  });

  it('returns alreadyGranted', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'alreadyGranted' }));
    expect(await requestPermission(userToken, input)).toEqual({ status: 'alreadyGranted' });
  });

  it('passes the relay error name and status through', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'InvalidToken' }, { status: 401 }));
    expect(await requestPermission(userToken, input)).toEqual({ error: 'InvalidToken', status: 401 });
    fetchMock.mockResolvedValueOnce(new Response('gateway', { status: 502 }));
    expect(await requestPermission(userToken, input)).toEqual({ error: 'HTTP 502', status: 502 });
  });

  it('refuses a 200 whose body has no known status', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'maybe' }));
    expect(await requestPermission(userToken, input)).toEqual({ error: 'UnexpectedResponse', status: 200 });
  });

  it('answers status 0 instead of throwing when the relay is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(await requestPermission(userToken, input)).toEqual({ error: 'ETIMEDOUT', status: 0 });
  });
});

describe('relaySigningKey', () => {
  const didDoc = (key: P256Keypair) => ({
    id: RELAY_DID,
    verificationMethod: [
      { id: `${RELAY_DID}#atproto`, type: 'Multikey', controller: RELAY_DID, publicKeyMultibase: key.did().slice('did:key:'.length) },
    ],
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves the stale key when the refetch fails, and refetches again next time', async () => {
    const relayKey = await P256Keypair.create();
    fetchMock.mockResolvedValueOnce(Response.json(didDoc(relayKey)));
    expect(await relaySigningKey()).toBe(relayKey.did());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.setSystemTime(Date.now() + 6 * 60_000);
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await relaySigningKey()).toBe(relayKey.did());
    expect(warn).toHaveBeenCalledTimes(1);
    // The failure did not refresh the cache, so the next call tries the relay again.
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await relaySigningKey()).toBe(relayKey.did());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects when there is no cached key to fall back on', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(relaySigningKey()).rejects.toThrow('ECONNRESET');
  });
});
