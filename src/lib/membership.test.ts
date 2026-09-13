import { describe, expect, it } from 'vitest';
import { canPost, gatedAt, joinMode, sponsorLine, standingFor, windowCovers } from './membership';

const forum = 'did:plc:forum';
const now = new Date('2026-09-15T00:00:00Z');
const open = { since: '2026-09-01T00:00:00Z', sponsor: 'did:plc:dave', via: 'invite' };
const closed = { since: '2026-08-01T00:00:00Z', until: '2026-09-10T00:00:00Z', sponsor: 'did:plc:dave', via: 'invite' };

describe('joinMode', () => {
  it('reads the profile and treats absent or unknown as open', () => {
    expect(joinMode(undefined)).toBe('open');
    expect(joinMode({})).toBe('open');
    expect(joinMode({ mode: 'apply' })).toBe('apply');
    expect(joinMode({ mode: 'invite' })).toBe('invite');
    expect(joinMode({ mode: 'whatever' })).toBe('open');
  });
});

describe('windowCovers', () => {
  it('covers from since up to but not including until', () => {
    expect(windowCovers(open, now)).toBe(true);
    expect(windowCovers(closed, new Date('2026-09-05T00:00:00Z'))).toBe(true);
    expect(windowCovers(closed, new Date('2026-09-10T00:00:00Z'))).toBe(false);
    expect(windowCovers(closed, new Date('2026-07-31T00:00:00Z'))).toBe(false);
    expect(windowCovers(undefined, now)).toBe(false);
  });
});

describe('gatedAt', () => {
  const periods = [
    { gatedSince: '2026-03-01T00:00:00Z', openedAt: '2026-06-01T00:00:00Z' },
    { gatedSince: '2026-09-01T00:00:00Z' },
  ];
  it('is false before the first gating, during an open period, and true inside a gated period', () => {
    expect(gatedAt(periods, new Date('2026-02-01T00:00:00Z'))).toBe(false);
    expect(gatedAt(periods, new Date('2026-04-01T00:00:00Z'))).toBe(true);
    expect(gatedAt(periods, new Date('2026-07-01T00:00:00Z'))).toBe(false);
    expect(gatedAt(periods, now)).toBe(true);
    expect(gatedAt([], now)).toBe(false);
  });
});

describe('standingFor', () => {
  it('is open on an open forum whatever else is true', () => {
    expect(standingFor({ mode: 'open', forumDid: forum, viewer: 'did:plc:m', declared: false })).toBe('open');
  });
  it('exempts the forum account on a gated forum', () => {
    expect(standingFor({ mode: 'invite', forumDid: forum, viewer: forum, declared: false })).toBe('exempt');
  });
  it('needs both an open window and a declaration to be a member', () => {
    const base = { mode: 'invite' as const, forumDid: forum, viewer: 'did:plc:m', now };
    expect(standingFor({ ...base, window: open, declared: true })).toBe('member');
    expect(standingFor({ ...base, window: open, declared: false })).toBe('accepted-undeclared');
    expect(standingFor({ ...base, window: undefined, declared: true })).toBe('nonmember');
    expect(standingFor({ ...base, window: closed, declared: true })).toBe('nonmember');
  });
  it('is nonmember when signed out', () => {
    expect(standingFor({ mode: 'apply', forumDid: forum, declared: false })).toBe('nonmember');
  });
});

describe('canPost', () => {
  it('allows open, member, and exempt only', () => {
    expect(canPost('open')).toBe(true);
    expect(canPost('member')).toBe(true);
    expect(canPost('exempt')).toBe(true);
    expect(canPost('accepted-undeclared')).toBe(false);
    expect(canPost('nonmember')).toBe(false);
  });
});

describe('sponsorLine', () => {
  const name = (did: string) => (did === 'did:plc:dave' ? '@dave' : undefined);
  it('names the sponsor by how they were brought in', () => {
    expect(sponsorLine({ since: '2026-09-01T00:00:00Z', sponsor: 'did:plc:dave', via: 'invite' }, name)).toBe('invited by @dave');
    expect(sponsorLine({ since: '2026-09-01T00:00:00Z', sponsor: 'did:plc:dave', via: 'application' }, name)).toBe('approved by @dave');
    expect(sponsorLine({ since: '2026-09-01T00:00:00Z', via: 'founding' }, name)).toBe('original member');
  });
  it('falls back for a sponsor that no longer resolves', () => {
    expect(sponsorLine({ since: '2026-09-01T00:00:00Z', sponsor: 'did:plc:gone', via: 'invite' }, name)).toBe('invited by a former member');
  });
});
