import { randomBytes } from 'node:crypto';
import { type P256Keypair, verifySignature } from '@atproto/crypto';

// Atproto service JWTs, minted and verified in-house: ES256 over the compact
// form, with `lxm` naming the method the token is good for. Pulling in
// @atproto/xrpc-server for this would bring Express along for one caller.

export interface ServiceJwtClaims {
  iss: string;
  aud: string;
  lxm: string;
  iat: number;
  exp: number;
  jti: string;
}

export type ServiceJwtFailure = 'malformed' | 'type' | 'expired' | 'audience' | 'method' | 'issuer' | 'signature';

export class ServiceJwtError extends Error {
  constructor(
    public readonly reason: ServiceJwtFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceJwtError';
  }
}

const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');

// P256Keypair.sign returns the raw 64-byte r||s that ES256 expects, so no DER
// conversion is needed. Fresh per call, never cached.
export async function mintServiceJwt(
  keypair: P256Keypair,
  { iss, aud, lxm, expiresInSeconds = 60 }: { iss: string; aud: string; lxm: string; expiresInSeconds?: number },
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const claims: ServiceJwtClaims = { iss, aud, lxm, iat, exp: iat + expiresInSeconds, jti: randomBytes(16).toString('hex') };
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = await keypair.sign(new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(signature)}`;
}

export interface VerifyOptions {
  aud: string | string[];
  lxm: string;
  iss: string;
  // Returns the issuer's did:key. Called again with forceRefresh after a
  // signature failure, once, so a rotated key is picked up.
  resolveKey: (iss: string, forceRefresh: boolean) => Promise<string>;
}

const CLOCK_LEEWAY_SECONDS = 5;

function decodePart(part: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

async function signatureHolds(didKey: string, input: Uint8Array, sig: Uint8Array): Promise<boolean> {
  try {
    return await verifySignature(didKey, input, sig);
  } catch {
    return false; // an unparseable key or signature is just a bad signature
  }
}

export async function verifyServiceJwt(token: string, expected: VerifyOptions): Promise<ServiceJwtClaims> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
    throw new ServiceJwtError('malformed', 'Malformed service token');
  }
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw new ServiceJwtError('malformed', 'Malformed service token');
  }
  // An access, refresh, or DPoP token is signed by a different party for a
  // different purpose and must never pass as a service token.
  if (typeof header.typ === 'string' && /^(at|refresh|dpop)\+jwt$/i.test(header.typ)) {
    throw new ServiceJwtError('type', 'Wrong token type for a service token');
  }
  const nowSeconds = Date.now() / 1000;
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_LEEWAY_SECONDS < nowSeconds) {
    throw new ServiceJwtError('expired', 'Service token expired');
  }
  const audiences = Array.isArray(expected.aud) ? expected.aud : [expected.aud];
  if (typeof payload.aud !== 'string' || !audiences.includes(payload.aud)) {
    throw new ServiceJwtError('audience', 'Service token audience is not this forum');
  }
  if (payload.lxm !== expected.lxm) {
    throw new ServiceJwtError('method', 'Service token is for a different method');
  }
  if (payload.iss !== expected.iss) {
    throw new ServiceJwtError('issuer', 'Service token issuer is not the relay');
  }
  const input = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = new Uint8Array(Buffer.from(parts[2], 'base64url'));
  const key = await expected.resolveKey(payload.iss, false);
  let ok = await signatureHolds(key, input, sig);
  if (!ok) {
    let fresh: string | null = null;
    try {
      fresh = await expected.resolveKey(payload.iss, true);
    } catch {
      // the refetch failing is no better than a stale key; report the signature
    }
    if (fresh && fresh !== key) ok = await signatureHolds(fresh, input, sig);
  }
  if (!ok) throw new ServiceJwtError('signature', 'Service token signature does not verify');
  return payload as unknown as ServiceJwtClaims;
}
