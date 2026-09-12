import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatMultikey, parseMultikey, verifySignature } from '@atproto/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mintSenderJwt,
  publicKeyMultibase,
  resetSenderForTests,
  senderDid,
  senderDidDocument,
  senderKeypair,
} from './sender';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'atmobb-sender-'));
  process.env.DATA_DIR = dataDir;
  process.env.ATMOBB_APP_URL = 'https://forum.example.net';
  resetSenderForTests();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.ATMOBB_APP_URL;
  vi.restoreAllMocks();
});

const keyPath = () => join(dataDir, 'notify', 'sender-key.json');
const mode = (path: string) => statSync(path).mode & 0o777;

describe('senderDid', () => {
  it('is did:web of the app host over https', () => {
    expect(senderDid()).toBe('did:web:forum.example.net');
  });
  it('is null for a plain-http dev URL', () => {
    process.env.ATMOBB_APP_URL = 'http://127.0.0.1:5173';
    expect(senderDid()).toBeNull();
  });
  it('is null for an https URL with a port, and when unset', () => {
    process.env.ATMOBB_APP_URL = 'https://forum.example.net:8443';
    expect(senderDid()).toBeNull();
    delete process.env.ATMOBB_APP_URL;
    expect(senderDid()).toBeNull();
  });
});

describe('senderKeypair', () => {
  it('creates the key file at mode 600 and loads the same key next time', async () => {
    const first = await senderKeypair();
    expect(existsSync(keyPath())).toBe(true);
    expect(mode(keyPath())).toBe(0o600);
    resetSenderForTests();
    const second = await senderKeypair();
    expect(second.did()).toBe(first.did());
  });
  it('returns the cached keypair on repeated calls', async () => {
    const a = await senderKeypair();
    const b = await senderKeypair();
    expect(b).toBe(a);
  });
  it('re-applies mode 600 to a key file left at 644', async () => {
    await senderKeypair();
    chmodSync(keyPath(), 0o644);
    expect(mode(keyPath())).toBe(0o644);
    resetSenderForTests();
    await senderKeypair();
    expect(mode(keyPath())).toBe(0o600);
  });
  it('warns about a probable partial restore when members exist without a key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mkdirSync(join(dataDir, 'notify', 'members'), { recursive: true });
    writeFileSync(join(dataDir, 'notify', 'members', 'did%3Aplc%3Aabc.json'), '{}');
    await senderKeypair();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/restore/i);
    expect(existsSync(keyPath())).toBe(true);
  });
  it('does not warn when the members directory is empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mkdirSync(join(dataDir, 'notify', 'members'), { recursive: true });
    await senderKeypair();
    expect(warn).not.toHaveBeenCalled();
  });
  it('refuses to replace a truncated key file and leaves it untouched', async () => {
    mkdirSync(join(dataDir, 'notify'), { recursive: true });
    const truncated = '{"privateKey":"abc';
    writeFileSync(keyPath(), truncated);
    await expect(senderKeypair()).rejects.toThrow(/exists but cannot be read/);
    expect(readFileSync(keyPath(), 'utf8')).toBe(truncated);
    expect(existsSync(`${keyPath()}.tmp`)).toBe(false);
  });
  it('still mints a key when the file is missing', async () => {
    expect(existsSync(keyPath())).toBe(false);
    const keypair = await senderKeypair();
    expect(keypair.did()).toMatch(/^did:key:z/);
    expect(existsSync(keyPath())).toBe(true);
    expect(existsSync(`${keyPath()}.tmp`)).toBe(false);
  });
  it('rejects when the directory is unwritable and retries on the next call', async () => {
    // A regular file where the notify directory should be makes mkdir fail
    // regardless of which user runs the tests.
    writeFileSync(join(dataDir, 'notify'), '');
    await expect(senderKeypair()).rejects.toThrow();
    rmSync(join(dataDir, 'notify'));
    const keypair = await senderKeypair();
    expect(keypair.did()).toMatch(/^did:key:z/);
  });
});

describe('publicKeyMultibase', () => {
  it('is a z-prefixed multikey that round-trips to the same key bytes', async () => {
    const keypair = await senderKeypair();
    const multikey = await publicKeyMultibase();
    expect(multikey.startsWith('z')).toBe(true);
    expect(`did:key:${multikey}`).toBe(keypair.did());
    const parsed = parseMultikey(multikey);
    expect(parsed.jwtAlg).toBe('ES256');
    expect(formatMultikey(parsed.jwtAlg, parsed.keyBytes)).toBe(multikey);
  });
});

function decodePart(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('mintSenderJwt', () => {
  it('produces a signed ES256 token with the expected claims', async () => {
    const before = Math.floor(Date.now() / 1000);
    const jwt = await mintSenderJwt('pub.atmo.notify.send', { aud: 'did:web:relay.atmo.pub' });
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePart(parts[0])).toEqual({ typ: 'JWT', alg: 'ES256' });
    const payload = decodePart(parts[1]);
    expect(payload.iss).toBe('did:web:forum.example.net');
    expect(payload.aud).toBe('did:web:relay.atmo.pub');
    expect(payload.lxm).toBe('pub.atmo.notify.send');
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.exp).toBe(payload.iat + 60);
    expect(payload.jti).toMatch(/^[0-9a-f]{32}$/);
    const keypair = await senderKeypair();
    const ok = await verifySignature(
      keypair.did(),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      new Uint8Array(Buffer.from(parts[2], 'base64url')),
    );
    expect(ok).toBe(true);
  });
  it('is fresh per call and honors a custom expiry', async () => {
    const a = await mintSenderJwt('pub.atmo.notify.send', { aud: 'did:web:relay.atmo.pub', expiresInSeconds: 5 });
    const b = await mintSenderJwt('pub.atmo.notify.send', { aud: 'did:web:relay.atmo.pub', expiresInSeconds: 5 });
    expect(a).not.toBe(b);
    const payload = decodePart(a.split('.')[1]);
    expect(payload.exp).toBe(payload.iat + 5);
  });
  it('refuses to mint when the forum has no resolvable sender', async () => {
    process.env.ATMOBB_APP_URL = 'http://127.0.0.1:5173';
    await expect(mintSenderJwt('pub.atmo.notify.send', { aud: 'did:web:relay.atmo.pub' })).rejects.toThrow(/https/);
  });
});

describe('senderDidDocument', () => {
  it('is null without an https app URL', async () => {
    process.env.ATMOBB_APP_URL = 'http://127.0.0.1:5173';
    expect(await senderDidDocument()).toBeNull();
  });
  it('describes the sender key and service', async () => {
    const doc = await senderDidDocument();
    const multikey = await publicKeyMultibase();
    expect(doc).toEqual({
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
      id: 'did:web:forum.example.net',
      verificationMethod: [
        {
          id: 'did:web:forum.example.net#atproto',
          type: 'Multikey',
          controller: 'did:web:forum.example.net',
          publicKeyMultibase: multikey,
        },
      ],
      service: [
        { id: '#atmobb_sender', type: 'AtmoNotifsSender', serviceEndpoint: 'https://forum.example.net' },
      ],
    });
  });
});
