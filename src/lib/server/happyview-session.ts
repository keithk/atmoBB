import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { isProduction, secretProblem } from './secrets';

// Must match the SESSION_SECRET HappyView runs with — the app and the engine
// share it so our signatures verify. Dev default mirrors docker-compose.yml.
const sessionSecret = () => env.HAPPYVIEW_SESSION_SECRET ?? 'dev-only-secret-not-for-production';

// Private boards need the shared secret. Deployments without it (hosted
// tenant forums) can't mint space sessions, so the feature is off entirely.
// In production the secret also has to be one Happyview would accept: a weak
// one means every space session is forgeable.
export const privateBoardsEnabled = () =>
  isProduction(env.NODE_ENV) ? secretProblem(env.HAPPYVIEW_SESSION_SECRET) === null : true;

// cookie-rs Key::derive_from: HKDF-SHA256 expand-only (secret is the PRK, no
// extract step), fixed info string, 64 bytes out; the signing key is the first
// 32. The SignedJar MACs the cookie's raw value with that key.
const KEYS_INFO = Buffer.from('COOKIE;SIGNED:HMAC-SHA256;PRIVATE:AEAD-AES-256-GCM');

function hkdfExpand(prk: Buffer, info: Buffer, len: number): Buffer {
  const out: Buffer[] = [];
  let prev = Buffer.alloc(0);
  for (let i = 1; out.reduce((n, b) => n + b.length, 0) < len; i++) {
    prev = createHmac('sha256', prk).update(prev).update(info).update(Buffer.from([i])).digest();
    out.push(prev);
  }
  return Buffer.concat(out).subarray(0, len);
}

let cachedSecret: string | null = null;
let cachedKey: Buffer | null = null;
function signingKey(): Buffer {
  const secret = sessionSecret();
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedSecret = secret;
  cachedKey = hkdfExpand(Buffer.from(secret), KEYS_INFO, 64).subarray(0, 32);
  return cachedKey;
}

/**
 * The raw (un-URL-encoded) value of a `happyview_session` cookie authenticating
 * as `did`. cookie-rs SignedJar format: base64(HMAC-SHA256(value)) prepended to
 * the value. Pass the result as `sessionCookie` to the appview XRPC helper,
 * which URL-encodes it before it goes on the wire.
 */
export function mintSessionCookie(did: string): string {
  const mac = createHmac('sha256', signingKey()).update(Buffer.from(did)).digest('base64');
  return mac + did;
}
