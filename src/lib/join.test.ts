import { describe, expect, it } from 'vitest';
import { JOIN_MESSAGES, TOKEN, joinView } from './join';

describe('joinView', () => {
  it('offers the confirm button only to a non-member in good standing with an open link', () => {
    expect(joinView({ invite: 'open', member: false, banned: false })).toBe('confirm');
  });

  it('reports a missing link before anything about the viewer', () => {
    expect(joinView({ invite: 'unknown', member: true, banned: true })).toBe('unknown');
  });

  it('tells an existing member so whatever the link says', () => {
    expect(joinView({ invite: 'open', member: true, banned: false })).toBe('member');
    expect(joinView({ invite: 'redeemed', member: true, banned: false })).toBe('member');
  });

  it('names the state of a link that cannot be spent', () => {
    for (const invite of ['expired', 'revoked', 'redeemed', 'reserved'] as const) {
      expect(joinView({ invite, member: false, banned: false })).toBe(invite);
    }
  });

  it('refuses a banned account and never clears one it could not check', () => {
    expect(joinView({ invite: 'open', member: false, banned: true })).toBe('banned');
    expect(joinView({ invite: 'open', member: false, banned: 'unknown' })).toBe('trouble');
    expect(joinView({ invite: 'open', member: 'unknown', banned: false })).toBe('trouble');
  });

  it('has a message for every refusal', () => {
    for (const view of ['unknown', 'expired', 'revoked', 'redeemed', 'reserved', 'member', 'banned', 'trouble'] as const) {
      expect(JOIN_MESSAGES[view]).toBeTruthy();
    }
  });
});

describe('TOKEN', () => {
  it('matches only 26 lowercase base32 characters', () => {
    expect(TOKEN.test('abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(TOKEN.test('abcdefghijklmnopqrstuvwxy')).toBe(false);
    expect(TOKEN.test('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(false);
    expect(TOKEN.test('abcdefghijklmnopqrstuvwxy1')).toBe(false);
  });
});
