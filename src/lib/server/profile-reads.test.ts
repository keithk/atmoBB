import { afterEach, expect, it, vi } from 'vitest';
import { getBoardIndex, getMembers, getThreadPage } from './appview';
import { getPublicProfile, bustProfileCache } from './profiles';

vi.mock('$env/dynamic/private', () => ({ env: { ATMOBB_FORUM_DID: 'did:plc:current' } }));
const profile = { displayName: 'Account', signature: [{ text: 'Account signature' }], notifications: true, forumProfiles: [
  { forum: 'did:plc:current', fields: ['displayName', 'signature', 'notifications'], displayName: 'Local', notifications: false },
  { forum: 'did:plc:other', fields: ['displayName'], displayName: 'Other' },
] };
afterEach(() => vi.unstubAllGlobals());

it('resolves indexed post, reply, participant, board and member profiles in the requested forum', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    thread: { authorProfile: profile, participants: [{ profile }] }, replies: [{ authorProfile: profile }],
    boards: [{ latest: { authorProfile: profile } }], members: [{ profile }],
  })));
  const thread = await getThreadPage('at://did:plc:author/app.atmobb.discussion.thread/test');
  expect(thread.thread?.authorProfile).toMatchObject({ displayName: 'Local' });
  expect(thread.replies[0].authorProfile).not.toHaveProperty('signature');
  expect((thread.thread as unknown as { participants: { profile: unknown }[] }).participants[0].profile).toMatchObject({ displayName: 'Local' });
  const index = await getBoardIndex('did:plc:other');
  expect(index.boards[0].latest?.authorProfile).toMatchObject({ displayName: 'Other', signature: [{ text: 'Account signature' }] });
  expect((await getMembers(undefined, 50, 'did:plc:current')).members[0].profile?.displayName).toBe('Local');
});

it('resolves cached public profiles and fails closed for unavailable notification preferences', async () => {
  const did = 'did:plc:read-test';
  bustProfileCache(did);
  const fetch = vi.fn(async () => Response.json({ value: profile }));
  vi.stubGlobal('fetch', fetch);
  expect(await getPublicProfile(did, 'https://pds.test')).toMatchObject({ displayName: 'Local', notifications: false });
  expect(await getPublicProfile(did, 'https://pds.test', true)).not.toHaveProperty('signature');
  expect(fetch).toHaveBeenCalledTimes(1);
  bustProfileCache(did);
  fetch.mockRejectedValue(new Error('Unavailable'));
  expect(await getPublicProfile(did, 'https://pds.test')).toBeNull();
  await expect(getPublicProfile(did, 'https://pds.test', true)).rejects.toThrow('unavailable');
  fetch.mockResolvedValue(Response.json({ error: 'RecordNotFound' }, { status: 400 }));
  expect(await getPublicProfile(did, 'https://pds.test', true)).toEqual({});
});
