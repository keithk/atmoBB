import { describe, expect, it } from 'vitest';
import { hereSince, type ProfileCard } from './profile-card';

describe('hereSince', () => {
  it('formats the profile creation date as month and year', () => {
    expect(hereSince('2026-07-15T12:00:00.000Z')).toBe('Jul 2026');
  });

  it('is null without a usable date', () => {
    expect(hereSince(null)).toBeNull();
    expect(hereSince(undefined)).toBeNull();
    expect(hereSince('')).toBeNull();
    expect(hereSince('not a date')).toBeNull();
  });
});

describe('ProfileCard', () => {
  it('carries no post counts or rank', () => {
    const card: ProfileCard = {
      did: 'did:plc:member',
      handle: 'member.test',
      displayName: 'Member',
      profile: null,
      presence: 'offline',
      joined: '2026-07-15T12:00:00.000Z',
      bsky: null,
      isYou: false,
      sponsor: null,
    };
    expect(Object.keys(card)).not.toContain('posts');
    expect(Object.keys(card)).not.toContain('globalPosts');
    expect(Object.keys(card)).not.toContain('rankTitle');
  });
});
