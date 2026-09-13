import { describe, expect, it } from 'vitest';
import { RESERVATION_TTL_MS, canMint, inviteExpiry, inviteState, newToken, openInvites } from './invites';

const now = new Date('2026-09-15T12:00:00Z');
const minter = 'did:plc:dave';
const fresh = { token: 't1', minter, createdAt: '2026-09-14T00:00:00Z', expiresAt: '2026-09-28T00:00:00Z' };

describe('newToken', () => {
  it('is url-safe, unguessable length, and unique', () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[a-z2-7]{26}$/);
    expect(a).not.toBe(b);
  });
});

describe('inviteExpiry', () => {
  it('adds the forum days to now', () => {
    expect(inviteExpiry(14, now)).toBe('2026-09-29T12:00:00.000Z');
  });
});

describe('inviteState', () => {
  it('is open until something happens to it', () => {
    expect(inviteState(fresh, now)).toBe('open');
  });
  it('is expired at the boundary and after', () => {
    expect(inviteState({ ...fresh, expiresAt: '2026-09-15T12:00:00Z' }, now)).toBe('expired');
    expect(inviteState({ ...fresh, expiresAt: '2026-09-01T00:00:00Z' }, now)).toBe('expired');
  });
  it('prefers redeemed, then revoked, over expiry', () => {
    expect(inviteState({ ...fresh, expiresAt: '2026-09-01T00:00:00Z', redeemedAt: '2026-08-20T00:00:00Z', redeemedBy: 'did:plc:n' }, now)).toBe('redeemed');
    expect(inviteState({ ...fresh, expiresAt: '2026-09-01T00:00:00Z', revokedAt: '2026-08-20T00:00:00Z' }, now)).toBe('revoked');
  });
  it('treats a live reservation as reserved and a stale one as open again', () => {
    expect(inviteState({ ...fresh, reservedAt: '2026-09-15T11:55:00Z' }, now)).toBe('reserved');
    const stale = new Date(now.getTime() - RESERVATION_TTL_MS - 1).toISOString();
    expect(inviteState({ ...fresh, reservedAt: stale }, now)).toBe('open');
  });
});

describe('openInvites', () => {
  it('counts a minter\'s open and reserved invites, not spent or expired ones', () => {
    const all = [
      fresh,
      { ...fresh, token: 't2', reservedAt: '2026-09-15T11:59:00Z' },
      { ...fresh, token: 't3', redeemedAt: '2026-09-14T00:00:00Z', redeemedBy: 'did:plc:n' },
      { ...fresh, token: 't4', expiresAt: '2026-09-01T00:00:00Z' },
      { ...fresh, token: 't5', minter: 'did:plc:other' },
    ];
    expect(openInvites(all, minter, now).map((i) => i.token)).toEqual(['t1', 't2']);
  });
});

describe('canMint', () => {
  it('lets staff mint without a cap and members mint under the cap', () => {
    expect(canMint({ cap: 3, open: 3, staff: true })).toBe(true);
    expect(canMint({ cap: 3, open: 2, staff: false })).toBe(true);
    expect(canMint({ cap: 3, open: 3, staff: false })).toBe(false);
    expect(canMint({ cap: 0, open: 0, staff: false })).toBe(false);
    expect(canMint({ cap: 0, open: 0, staff: true })).toBe(true);
  });
});
