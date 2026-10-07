import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  getRecord: vi.fn(),
  putRecord: vi.fn(),
  uploadBlob: vi.fn(),
  listRecords: vi.fn(),
  createRecord: vi.fn(),
}));
const space = vi.hoisted(() => ({ getSpaceRecord: vi.fn() }));
const profiles = vi.hoisted(() => ({ bustProfileCache: vi.fn() }));

vi.mock('./atproto-oauth', () => ({
  agentFor: async () => ({ com: { atproto: { repo } } }),
}));

vi.mock('./appview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./appview')>()),
  getSpaceRecord: space.getSpaceRecord,
}));

vi.mock('./profiles', () => profiles);

import { getOwnAvatarProfile, saveProfile, setPinned, setWearing } from './pds';
import { profileForForum } from '$lib/profile-overrides';

beforeEach(() => {
  repo.getRecord.mockReset();
  repo.putRecord.mockReset();
  repo.uploadBlob.mockReset();
  repo.listRecords.mockReset();
  repo.createRecord.mockReset();
  space.getSpaceRecord.mockReset();
  profiles.bustProfileCache.mockReset();
});

describe('profile avatars', () => {
  it('preserves defaults and other forums across local edits, clearing, and inheritance', async () => {
    let existing: Record<string, unknown> = { displayName: 'Keith', signature: [{ text: 'Global' }], theme: 'forest', notifications: false,
      forumProfiles: [{ forum: 'did:plc:other', fields: ['signature'], signature: [{ text: 'Other' }] }], extension: 'keep' };
    repo.getRecord.mockImplementation(async () => ({ data: { value: existing } }));
    repo.putRecord.mockImplementation(async ({ record }) => { existing = record; });
    const did = 'did:plc:scope-test';
    const forum = 'did:plc:friends';
    await saveProfile(did, { signature: [{ text: 'Titular Keith' }], notifications: true }, forum);
    expect(profileForForum(existing, forum)).toMatchObject({ displayName: 'Keith', signature: [{ text: 'Titular Keith' }], notifications: true });
    await saveProfile(did, { signature: [], website: '' }, forum);
    expect(profileForForum(existing, forum)).not.toHaveProperty('signature');
    expect(profileForForum(existing, forum).notifications).toBe(true);
    expect(existing.signature).toEqual([{ text: 'Global' }]);
    await saveProfile(did, { displayName: 'Account name' });
    expect(profileForForum(existing, forum)).not.toHaveProperty('signature');
    await saveProfile(did, {}, forum, ['signature', 'website', 'notifications']);
    expect(profileForForum(existing, forum)).toMatchObject({ displayName: 'Account name', signature: [{ text: 'Global' }], notifications: false, theme: 'forest', extension: 'keep' });
    expect(existing.forumProfiles).toEqual([{ forum: 'did:plc:other', fields: ['signature'], signature: [{ text: 'Other' }] }]);
  });

  it('uploads and restores forum avatars without removing the account avatar', async () => {
    let existing: Record<string, unknown> = { avatar: { ref: { $link: 'global' } } };
    repo.getRecord.mockImplementation(async () => ({ data: { value: existing } }));
    repo.putRecord.mockImplementation(async ({ record }) => { existing = record; });
    repo.uploadBlob.mockResolvedValue({ data: { blob: { ref: { $link: 'local' } } } });
    await saveProfile('did:plc:avatar-scope', { avatar: { bytes: new Uint8Array([1]), mimeType: 'image/png' } }, 'did:plc:friends');
    expect(profileForForum(existing, 'did:plc:friends').avatar).toEqual({ ref: { $link: 'local' } });
    await saveProfile('did:plc:avatar-scope', { avatar: null }, 'did:plc:friends');
    expect(profileForForum(existing, 'did:plc:friends')).not.toHaveProperty('avatar');
    expect(existing.avatar).toEqual({ ref: { $link: 'global' } });
    await saveProfile('did:plc:avatar-scope', {}, 'did:plc:friends', ['avatar']);
    expect(existing).not.toHaveProperty('forumProfiles');
    expect(profileForForum(existing, 'did:plc:friends').avatar).toEqual({ ref: { $link: 'global' } });
  });

  it('never replaces the account record when reading it fails', async () => {
    repo.getRecord.mockRejectedValue(new Error('PDS unavailable'));
    await expect(saveProfile('did:plc:unavailable', { signature: [] }, 'did:plc:friends')).rejects.toThrow('PDS unavailable');
    expect(repo.putRecord).not.toHaveBeenCalled();
  });

  it('guards writes against concurrent edits and asserts absence for a new profile', async () => {
    repo.getRecord.mockResolvedValue({ data: { value: { displayName: 'Keith' }, cid: 'bafy-current' } });
    repo.putRecord.mockRejectedValueOnce(new Error('InvalidSwap'));
    await expect(saveProfile('did:plc:race', { signature: [] }, 'did:plc:friends')).rejects.toThrow('InvalidSwap');
    expect(repo.putRecord.mock.calls[0][0].swapRecord).toBe('bafy-current');
    repo.getRecord.mockRejectedValue({ error: 'RecordNotFound' });
    await saveProfile('did:plc:new', { displayName: 'New member' });
    expect(repo.putRecord.mock.calls[1][0]).toMatchObject({ swapRecord: null, record: { displayName: 'New member' } });
  });

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

  it('saves personal page fields per forum, clears About me on one forum only, and busts the profile cache', async () => {
    const about = [{ $type: 'app.atmobb.richtext.block#text', text: 'Account about' }];
    let existing: Record<string, unknown> = { headline: 'Account headline', about };
    repo.getRecord.mockImplementation(async () => ({ data: { value: existing } }));
    repo.putRecord.mockImplementation(async ({ record }) => { existing = record; });
    const did = 'did:plc:personal-page';
    await saveProfile(did, { headline: 'Friends headline' }, 'did:plc:friends');
    expect(existing.forumProfiles).toEqual([{ forum: 'did:plc:friends', fields: ['headline'], headline: 'Friends headline' }]);
    expect(profileForForum(existing, 'did:plc:friends').headline).toBe('Friends headline');
    expect(profileForForum(existing, 'did:plc:other').headline).toBe('Account headline');
    await saveProfile(did, { about: [] }, 'did:plc:friends');
    expect(profileForForum(existing, 'did:plc:friends')).not.toHaveProperty('about');
    expect(profileForForum(existing, 'did:plc:other').about).toEqual(about);
    expect(existing.about).toEqual(about);
    expect(profiles.bustProfileCache).toHaveBeenCalledWith(did);
  });

  it('saves every personal page field on the account and keeps fields other apps wrote', async () => {
    let existing: Record<string, unknown> = { displayName: 'Keith', elsewhere: 'keep' };
    repo.getRecord.mockImplementation(async () => ({ data: { value: existing } }));
    repo.putRecord.mockImplementation(async ({ record }) => { existing = record; });
    const page = {
      profileSkin: 'scrapbook',
      banner: { pattern: 'stripes', swatch: 'sunset' },
      headline: 'Hello',
      currently: 'Reading',
      about: [{ $type: 'app.atmobb.richtext.block#text', text: 'About me' }],
      panels: [{ id: 'stamps' }, { id: 'activity', hidden: true }],
    };
    await saveProfile('did:plc:skin', page);
    expect(existing).toMatchObject({ ...page, displayName: 'Keith', elsewhere: 'keep' });
    await saveProfile('did:plc:skin', { profileSkin: '', headline: '', currently: '', about: [], panels: [], banner: undefined });
    for (const key of Object.keys(page)) expect(existing).not.toHaveProperty(key);
    expect(existing).toMatchObject({ displayName: 'Keith', elsewhere: 'keep' });
  });
});

describe('membership pins', () => {
  const forum = 'did:plc:friends';
  const board = `at://${forum}/app.atmobb.forum.board/general`;
  const thread = (did: string, rkey: string) => `at://${did}/app.atmobb.discussion.thread/${rkey}`;
  const spaceThread = (did: string, rkey: string) =>
    `at://${forum}/space/app.atmobb.forum.privateBoard/secret/${did}/app.atmobb.discussion.thread/${rkey}`;

  /** A member's PDS holding membership records and their threads, all on `board` unless listed in `elsewhere`. */
  function fakePds(memberships: Record<string, unknown>[] = [], elsewhere: string[] = []) {
    const records = memberships.map((value, i) => ({ uri: `at://did:plc:x/app.atmobb.forum.membership/m${i}`, value }));
    repo.listRecords.mockImplementation(async () => {
      await Promise.resolve();
      return { data: { records: [...records] } };
    });
    repo.createRecord.mockImplementation(async ({ record }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      records.push({ uri: `at://did:plc:x/app.atmobb.forum.membership/m${records.length}`, value: record });
      return { data: {} };
    });
    repo.putRecord.mockImplementation(async ({ rkey, record }) => {
      const at = records.findIndex((r) => r.uri.endsWith(`/${rkey}`));
      records[at] = { ...records[at], value: record };
    });
    repo.getRecord.mockImplementation(async ({ repo: did, rkey }) => ({
      data: { value: { board: elsewhere.includes(rkey) ? 'at://did:plc:elsewhere/app.atmobb.forum.board/b' : board, author: did } },
    }));
    space.getSpaceRecord.mockImplementation(async () => ({ value: { board } }));
    return records;
  }

  it('creates the membership record carrying the pins when there is none', async () => {
    const did = 'did:plc:pin-new';
    const records = fakePds();
    await setPinned(did, forum, [thread(did, 't1')]);
    expect(records).toHaveLength(1);
    expect(records[0].value).toMatchObject({ $type: 'app.atmobb.forum.membership', forum, pinned: [thread(did, 't1')] });
  });

  it('keeps wearing when pinning, and keeps pins when wearing changes', async () => {
    const did = 'did:plc:pin-wearing';
    const records = fakePds([{ $type: 'app.atmobb.forum.membership', forum, wearing: ['atmobb:arrival'], createdAt: 'then' }]);
    await setPinned(did, forum, [thread(did, 't1')]);
    expect(records[0].value).toMatchObject({ wearing: ['atmobb:arrival'], pinned: [thread(did, 't1')], createdAt: 'then' });
    await setWearing(did, forum, ['atmobb:early-days']);
    expect(records[0].value).toMatchObject({ wearing: ['atmobb:early-days'], pinned: [thread(did, 't1')] });
    await setPinned(did, forum, []);
    expect(records[0].value).not.toHaveProperty('pinned');
    expect(records[0].value).toMatchObject({ wearing: ['atmobb:early-days'] });
    expect(profiles.bustProfileCache).toHaveBeenCalledWith(did);
  });

  it("rejects another member's thread, a thread on another forum, a reply, duplicates and more than four pins", async () => {
    const did = 'did:plc:pin-owner';
    fakePds([], ['away']);
    await expect(setPinned(did, forum, [thread('did:plc:someone-else', 't1')])).rejects.toThrow();
    await expect(setPinned(did, forum, [spaceThread('did:plc:someone-else', 't1')])).rejects.toThrow();
    await expect(setPinned(did, forum, [thread(did, 'away')])).rejects.toThrow();
    await expect(setPinned(did, forum, [`at://${did}/app.atmobb.discussion.reply/r1`])).rejects.toThrow();
    await expect(setPinned(did, forum, [thread(did, 't1'), thread(did, 't1')])).rejects.toThrow();
    await expect(setPinned(did, forum, ['t1', 't2', 't3', 't4', 't5'].map((rkey) => thread(did, rkey)))).rejects.toThrow();
    expect(repo.createRecord).not.toHaveBeenCalled();
    expect(repo.putRecord).not.toHaveBeenCalled();
  });

  it("accepts the owner's own members-only thread and four pins", async () => {
    const did = 'did:plc:pin-space';
    const records = fakePds();
    const pins = [spaceThread(did, 's1'), thread(did, 't2'), thread(did, 't3'), thread(did, 't4')];
    await setPinned(did, forum, pins);
    expect(records[0].value).toMatchObject({ pinned: pins });
    expect(space.getSpaceRecord).toHaveBeenCalledWith(did, `at://${forum}/space/app.atmobb.forum.privateBoard/secret`, did, 'app.atmobb.discussion.thread', 's1');
  });

  it('leaves one membership record after two concurrent pin saves', async () => {
    const did = 'did:plc:pin-race';
    const records = fakePds();
    await Promise.all([setPinned(did, forum, [thread(did, 't1')]), setPinned(did, forum, [thread(did, 't2')])]);
    expect(records).toHaveLength(1);
    expect(records[0].value).toMatchObject({ pinned: [thread(did, 't2')] });
  });
});
