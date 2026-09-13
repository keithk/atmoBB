import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  getRecord: vi.fn(),
  putRecord: vi.fn(),
  uploadBlob: vi.fn(),
}));

vi.mock('./atproto-oauth', () => ({
  agentFor: async () => ({ com: { atproto: { repo } } }),
}));

import { saveProfile } from './pds';

beforeEach(() => {
  repo.getRecord.mockReset();
  repo.putRecord.mockReset();
  repo.uploadBlob.mockReset();
});

describe('profile avatars', () => {
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
