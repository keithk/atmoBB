import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { P256Keypair } from '@atproto/crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_DID, resetRelayForTests, setFetchForTests } from './relay';
import { mintServiceJwt } from './service-jwt';
import { applyCallback, readMember, resetStoreForTests, setStatus } from './store';
import { handleSubscriberChanged } from './webhook';

const forumDid = 'did:web:forum.example.net';
const lxm = 'pub.atmo.notify.subscriberChanged';
const member = 'did:plc:alice';

let relayKey: P256Keypair;
let dataDir: string;

beforeAll(async () => {
  relayKey = await P256Keypair.create();
});

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'atmobb-webhook-'));
  process.env.DATA_DIR = dataDir;
  process.env.ATMOBB_APP_URL = 'https://forum.example.net';
  resetStoreForTests();
  resetRelayForTests();
  setFetchForTests((async () =>
    Response.json({
      id: RELAY_DID,
      verificationMethod: [
        { id: `${RELAY_DID}#atproto`, type: 'Multikey', controller: RELAY_DID, publicKeyMultibase: relayKey.did().slice('did:key:'.length) },
      ],
    })) as unknown as typeof fetch);
});

afterEach(async () => {
  resetRelayForTests();
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.ATMOBB_APP_URL;
  vi.restoreAllMocks();
});

const relayToken = (overrides: Partial<{ iss: string; aud: string; lxm: string }> = {}) =>
  mintServiceJwt(relayKey, { iss: RELAY_DID, aud: forumDid, lxm, ...overrides });

async function post(body: string | object, init: { token?: string; contentType?: string } = {}) {
  const token = init.token ?? (await relayToken());
  return handleSubscriberChanged(
    new Request('https://forum.example.net/xrpc/pub.atmo.notify.subscriberChanged', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': init.contentType ?? 'application/json',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

describe('handleSubscriberChanged', () => {
  it('applies a valid callback from the relay and answers ok', async () => {
    const res = await post({ recipient: member, enabled: true, changedAt: '2026-09-12T12:00:00Z' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const state = await readMember(member);
    expect(state?.status).toBe('on');
    expect(state?.relayChangedAt).toBe('2026-09-12T12:00:00Z');
  });

  it('answers 404 when the forum has no sender identity', async () => {
    process.env.ATMOBB_APP_URL = 'http://127.0.0.1:5173';
    const res = await post({ recipient: member, enabled: true });
    expect(res.status).toBe(404);
    expect(await readMember(member)).toBeNull();
  });

  it('answers 403 and writes nothing when the issuer is another DID', async () => {
    const res = await post({ recipient: member, enabled: true }, { token: await relayToken({ iss: 'did:web:evil.example' }) });
    expect(res.status).toBe(403);
    expect(await readMember(member)).toBeNull();
  });

  it('answers 401 for a missing, malformed, or wrongly signed token', async () => {
    const forged = await mintServiceJwt(await P256Keypair.create(), { iss: RELAY_DID, aud: forumDid, lxm });
    expect((await post({ recipient: member, enabled: true }, { token: forged })).status).toBe(401);
    expect((await post({ recipient: member, enabled: true }, { token: 'garbage' })).status).toBe(401);
    expect((await post({ recipient: member, enabled: true }, { token: await relayToken({ lxm: 'pub.atmo.notify.send' }) })).status).toBe(401);
    const noAuth = await handleSubscriberChanged(
      new Request('https://forum.example.net/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    expect(noAuth.status).toBe(401);
    expect(await readMember(member)).toBeNull();
  });

  it('answers 400 for a body missing enabled, a non-JSON content type, or a 9 KB body', async () => {
    expect((await post({ recipient: member })).status).toBe(400);
    expect((await post({ recipient: member, enabled: 'yes' })).status).toBe(400);
    expect((await post({ recipient: 'alice', enabled: true })).status).toBe(400);
    expect((await post('recipient=x', { contentType: 'application/x-www-form-urlencoded' })).status).toBe(400);
    expect((await post('{not json')).status).toBe(400);
    const big = JSON.stringify({ recipient: member, enabled: true, pad: 'x'.repeat(9 * 1024) });
    expect((await post(big)).status).toBe(400);
    expect(await readMember(member)).toBeNull();
  });

  it('leaves state unchanged when changedAt is older than the stored relay clock', async () => {
    await applyCallback(member, true, '2026-09-12T12:00:00Z');
    const res = await post({ recipient: member, enabled: false, changedAt: '2026-09-12T11:00:00Z' });
    expect(res.status).toBe(200);
    const state = await readMember(member);
    expect(state?.status).toBe('on');
    expect(state?.relayChangedAt).toBe('2026-09-12T12:00:00Z');
  });

  it('applies a callback without changedAt and leaves relayChangedAt alone', async () => {
    await applyCallback(member, true, '2026-09-12T12:00:00Z');
    const res = await post({ recipient: member, enabled: false });
    expect(res.status).toBe(200);
    const state = await readMember(member);
    expect(state?.status).toBe('off');
    expect(state?.relayChangedAt).toBe('2026-09-12T12:00:00Z');
  });

  it('answers 500 when the store cannot be written so the relay retries', async () => {
    await setStatus(member, 'pending');
    // A regular file where the members directory should be makes the write fail.
    await rm(join(dataDir, 'notify', 'members'), { recursive: true });
    await writeFile(join(dataDir, 'notify', 'members'), '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ recipient: member, enabled: true });
    expect(res.status).toBe(500);
    expect(error).toHaveBeenCalled();
  });
});
