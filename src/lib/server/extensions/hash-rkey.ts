import { createHash } from 'node:crypto';

const B32 = '234567abcdefghijklmnopqrstuvwxyz';

/** A record key derived from `input`: the first 160 bits of its SHA-256, in base32. */
export function hashRkey(input: string): string {
  const digest = createHash('sha256').update(input).digest().subarray(0, 20);
  let bits = 0n;
  for (const byte of digest) bits = (bits << 8n) | BigInt(byte);
  let key = '';
  for (let i = 31; i >= 0; i--) key += B32[Number((bits >> BigInt(i * 5)) & 31n)];
  return key;
}
