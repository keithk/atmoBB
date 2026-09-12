import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { P256Keypair } from '@atproto/crypto';

// Each forum is its own atmo.pub sender: a did:web on the app host, backed by
// a P-256 key kept beside the OAuth stores so the existing backup covers it.
// Configuration is read from process.env at call time so tests can set it.
const notifyDir = () => join(process.env.DATA_DIR ?? '.data', 'notify');
const keyPath = () => join(notifyDir(), 'sender-key.json');
const membersDir = () => join(notifyDir(), 'members');

interface StoredKey {
  privateKey: string; // raw 32 bytes, base64url
  did: string; // did:key of the public half, for debugging only
}

// did:web with a port is only valid for localhost, and localhost is never a
// resolvable sender, so any port means no identity.
export function senderDid(): string | null {
  const raw = process.env.ATMOBB_APP_URL;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port) return null;
  return `did:web:${url.hostname}`;
}

function warnIfPartialRestore() {
  let files: string[] = [];
  try {
    files = readdirSync(membersDir());
  } catch {
    return; // no members directory yet, nothing to worry about
  }
  if (files.length === 0) return;
  console.warn(
    `[notify] ${files.length} member file(s) exist under ${membersDir()} but there is no sender key at ${keyPath()}. ` +
      'This looks like a partial restore: a new sender identity is about to be minted and every member will have to re-approve on atmo.pub.',
  );
}

async function loadOrCreateKeypair(): Promise<P256Keypair> {
  let stored: StoredKey | null = null;
  try {
    stored = JSON.parse(readFileSync(keyPath(), 'utf8'));
  } catch {
    // no key yet (or unreadable), create one below
  }
  if (stored) {
    // Never trust the mode the file arrived with: a restore or a copy can
    // leave it world-readable.
    chmodSync(keyPath(), 0o600);
    return P256Keypair.import(new Uint8Array(Buffer.from(stored.privateKey, 'base64url')), { exportable: true });
  }
  warnIfPartialRestore();
  const keypair = await P256Keypair.create({ exportable: true });
  const file: StoredKey = {
    privateKey: Buffer.from(await keypair.export()).toString('base64url'),
    did: keypair.did(),
  };
  mkdirSync(notifyDir(), { recursive: true });
  writeFileSync(keyPath(), JSON.stringify(file), { mode: 0o600 });
  chmodSync(keyPath(), 0o600);
  return keypair;
}

let cached: Promise<P256Keypair> | null = null;

// Cached only on success: a failed creation (unwritable data directory, say)
// must be retried on the next call rather than poisoning the process.
export function senderKeypair(): Promise<P256Keypair> {
  if (!cached) {
    cached = loadOrCreateKeypair().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

export function resetSenderForTests() {
  cached = null;
}

export async function publicKeyMultibase(): Promise<string> {
  const keypair = await senderKeypair();
  return keypair.did().replace(/^did:key:/, '');
}

export interface ServiceJwtClaims {
  iss: string;
  aud: string;
  lxm: string;
  iat: number;
  exp: number;
  jti: string;
}

const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');

// ES256 over the compact JWT form. P256Keypair.sign returns the raw 64-byte
// r||s that ES256 expects, so no DER conversion is needed.
export async function signServiceJwt(keypair: P256Keypair, claims: ServiceJwtClaims): Promise<string> {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = await keypair.sign(new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(signature)}`;
}

export async function mintSenderJwt(
  lxm: string,
  { aud, expiresInSeconds = 60 }: { aud: string; expiresInSeconds?: number },
): Promise<string> {
  const iss = senderDid();
  if (!iss) throw new Error('No sender identity: ATMOBB_APP_URL must be an https URL without a port');
  const keypair = await senderKeypair();
  const iat = Math.floor(Date.now() / 1000);
  return signServiceJwt(keypair, {
    iss,
    aud,
    lxm,
    iat,
    exp: iat + expiresInSeconds,
    jti: randomBytes(16).toString('hex'),
  });
}

// The relay does not read the service entry yet; it is published so callbacks
// resolve once senders are looked up from DID documents.
export async function senderDidDocument() {
  const did = senderDid();
  if (!did) return null;
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: did,
    verificationMethod: [
      { id: `${did}#atproto`, type: 'Multikey', controller: did, publicKeyMultibase: await publicKeyMultibase() },
    ],
    service: [{ id: '#atmobb_sender', type: 'AtmoNotifsSender', serviceEndpoint: process.env.ATMOBB_APP_URL }],
  };
}
