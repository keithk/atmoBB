import { describe, expect, it } from 'vitest';
import { profileForForum } from './profile-overrides';
import { validateRecord } from '../lexicon/types/app/atmobb/actor/profile';

const signature = [{ $type: 'app.atmobb.richtext.block#text', text: 'Account signature' }];
const profile = {
  $type: 'app.atmobb.actor.profile', displayName: 'Keith', description: 'Account bio', signature,
  pronouns: 'they/them', website: 'https://example.com', notifications: false,
  forumProfiles: [
    { forum: 'did:plc:friends', fields: ['signature', 'notifications'], signature: [{ ...signature[0], text: "I'm the titular keith" }], notifications: true },
    { forum: 'did:plc:software', fields: ['signature', 'website', 'description'] },
  ],
};

describe('forum profile resolution', () => {
  it('distinguishes a custom signature, explicitly empty signature, and inheritance without mutating defaults', () => {
    expect(profileForForum(profile, 'did:plc:friends')).toMatchObject({ displayName: 'Keith', notifications: true, signature: [{ text: "I'm the titular keith" }] });
    const software = profileForForum(profile, 'did:plc:software');
    expect(software).not.toHaveProperty('signature');
    expect(software).not.toHaveProperty('website');
    expect(software).not.toHaveProperty('description');
    expect(software.pronouns).toBe('they/them');
    expect(software.notifications).toBe(false);
    expect(profileForForum(profile, 'did:plc:unconfigured').signature).toEqual(signature);
    expect(profile.signature).toEqual(signature);
    expect(validateRecord(profile).success).toBe(true);
  });

  it('cannot override identity, themes or unlisted fields from a forum entry', () => {
    const value = { displayName: 'Default', theme: 'forest', forumProfiles: [
      { forum: 'did:plc:friends', fields: ['theme', 'createdAt'], theme: 'sky', displayName: 'Ignored', createdAt: 'bad' },
    ] };
    expect(profileForForum(value, 'did:plc:friends')).toEqual(value);
    expect(profileForForum(null, 'did:plc:friends')).toBeNull();
    expect(profileForForum({ forumProfiles: [null, { forum: 'did:plc:friends' }] }, 'did:plc:friends')).toEqual({ forumProfiles: [null, { forum: 'did:plc:friends' }] });
  });
});
