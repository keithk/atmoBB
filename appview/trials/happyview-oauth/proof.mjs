// Independent test oracle: validate the proof against the expected session,
// not merely against whichever public key the proof supplies.
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

export const hash = (value) => createHash('sha256').update(value).digest('base64url');
export const thumbprint = ({ crv, kty, x, y }) => hash(JSON.stringify({ crv, kty, x, y }));

export async function verifyProof(request, expectedKey, expectedToken) {
  const encoded = request.headers.get('dpop');
  assert.ok(encoded, 'SDK must sign authenticated requests');
  const [header, payload, signature] = encoded.split('.');
  const metadata = JSON.parse(Buffer.from(header, 'base64url'));
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(metadata.alg, 'ES256');
  assert.equal(metadata.typ, 'dpop+jwt');
  assert.equal(metadata.jwk.d, undefined, 'proof must not disclose the private key');
  assert.equal(thumbprint(metadata.jwk), thumbprint(expectedKey), 'proof must use the registered signing key');
  const publicKey = await webcrypto.subtle.importKey(
    'jwk', metadata.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  );
  assert.ok(await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey,
    Buffer.from(signature, 'base64url'), Buffer.from(`${header}.${payload}`),
  ));
  assert.equal(claims.htm, request.method);
  assert.equal(claims.htu, request.url.split('?')[0]);
  if (expectedToken !== undefined) {
    assert.equal(request.headers.get('authorization'), `DPoP ${expectedToken}`);
    assert.equal(claims.ath, hash(expectedToken));
  } else {
    // Token-endpoint proofs precede issuance and must not use an access token.
    assert.equal(request.headers.get('authorization'), null);
  }
  return claims;
}
