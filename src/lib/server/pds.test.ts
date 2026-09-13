import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  getRecord: vi.fn(),
  putRecord: vi.fn(),
  uploadBlob: vi.fn(),
}));

vi.mock('./atproto-oauth', () => ({
  agentFor: async () => ({ com: { atproto: { repo } } }),
}));

import { getOwnAvatarProfile, saveProfile } from './pds';

beforeEach(() => {
  repo.getRecord.mockReset();
  repo.putRecord.mockReset();
  repo.uploadBlob.mockReset();
});

describe('profile avatars', () => {
  it('persists forum opt-outs, preserves them during profile edits, and clears them from the layout cache', async () => {
    let existing = { displayName: 'Keep me', theme: 'forest' };
    repo.getRecord.mockImplementation(async () => ({ data: { value: existing } }));
    repo.putRecord.mockImplementation(async ({ record }) => { existing = record; });
    const did = 'did:plc:forum-theme-test';
    await saveProfile(did, { forumThemes: [{ forum: 'did:plc:forum', theme: '' }] });
    expect(await getOwnAvatarProfile(did)).toMatchObject({ theme: 'forest', forumThemes: [{ forum: 'did:plc:forum', theme: '' }] });
    await saveProfile(did, { displayName: 'Renamed' });
    expect(repo.putRecord.mock.calls[1][0].record.forumThemes).toEqual([{ forum: 'did:plc:forum', theme: '' }]);
    await saveProfile(did, { forumThemes: [] });
    expect(await getOwnAvatarProfile(did)).not.toHaveProperty('forumThemes');
    expect(await getOwnAvatarProfile(did)).toMatchObject({ displayName: 'Renamed', theme: 'forest' });
  });
  it('saves and clears a personal theme without losing other profile fields, updating the layout cache', async () => {
    const existing = { displayName: 'Theme user', theme: 'forest', extension: 'preserved' };
    repo.getRecord.mockImplementation(async () => ({ data: { value: existing } }));
    repo.putRecord.mockImplementation(async ({ record }) => Object.assign(existing, record));
    const did = 'did:plc:theme-test';
    await saveProfile(did, { theme: 'classic' });
    expect(repo.putRecord.mock.calls[0][0].record).toMatchObject({ theme: 'classic', extension: 'preserved' });
    expect((await getOwnAvatarProfile(did)).theme).toBe('classic');
    await saveProfile(did, { displayName: 'Renamed' });
    expect(repo.putRecord.mock.calls[1][0].record.theme).toBe('classic');
    await saveProfile(did, { theme: '' });
    expect(repo.putRecord.mock.calls[2][0].record).not.toHaveProperty('theme');
    expect(await getOwnAvatarProfile(did)).toMatchObject({ displayName: 'Renamed', extension: 'preserved' });
    expect((await getOwnAvatarProfile(did)).theme).toBeUndefined();
  });

  it('removes only the local avatar override when restoring the Bluesky default', async () => {
    repo.getRecord.mockResolvedValue({
      data: {
        value: {
          $type: 'app.atmobb.actor.profile',
          displayName: 'Sky User',
          description: 'Keep this bio',
          pronouns: 'they/them',
          avatar: { ref: { $link: 'bafyoverride' } },
          createdAt: '2026-01-02T03:04:05.000Z',
          extensionField: 'keep this too',
        },
      },
    });
    repo.putRecord.mockResolvedValue({});

    await saveProfile('did:plc:restore-avatar-test', { avatar: null });

    const record = repo.putRecord.mock.calls[0][0].record;
    expect(record).not.toHaveProperty('avatar');
    expect(record).toMatchObject({
      displayName: 'Sky User',
      description: 'Keep this bio',
      pronouns: 'they/them',
      createdAt: '2026-01-02T03:04:05.000Z',
      extensionField: 'keep this too',
    });
    expect(repo.uploadBlob).not.toHaveBeenCalled();
  });
});
