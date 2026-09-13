/** An invite link as stored in the forum's local invite store. The token is
 *  the secret in the link, so invites are never atproto records. */
export interface Invite {
  token: string;
  minter: string;
  createdAt: string;
  expiresAt: string;
  /** Set while a redemption is in flight, so a second submission cannot
   *  spend the same link. Stale reservations count as open again. */
  reservedAt?: string;
  redeemedAt?: string;
  redeemedBy?: string;
  revokedAt?: string;
}

export type InviteState = 'open' | 'reserved' | 'redeemed' | 'revoked' | 'expired';

/** How long a reservation holds before a crashed redemption releases it. */
export const RESERVATION_TTL_MS = 10 * 60_000;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** 128 random bits as 26 lowercase base32 characters, safe in a URL path. */
export function newToken(bytes?: Uint8Array): string {
  const b = bytes ?? crypto.getRandomValues(new Uint8Array(16));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of b) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function inviteExpiry(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

export function inviteState(invite: Invite, now = new Date()): InviteState {
  if (invite.redeemedAt) return 'redeemed';
  if (invite.revokedAt) return 'revoked';
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (invite.reservedAt && now.getTime() - new Date(invite.reservedAt).getTime() <= RESERVATION_TTL_MS) return 'reserved';
  return 'open';
}

/** A minter's invites that still count against their cap. */
export function openInvites(invites: Invite[], minter: string, now = new Date()): Invite[] {
  return invites.filter((i) => {
    if (i.minter !== minter) return false;
    const s = inviteState(i, now);
    return s === 'open' || s === 'reserved';
  });
}

/** Staff mint freely; members mint while under the forum's cap. */
export function canMint(input: { cap: number; open: number; staff: boolean }): boolean {
  return input.staff || (input.cap > 0 && input.open < input.cap);
}
