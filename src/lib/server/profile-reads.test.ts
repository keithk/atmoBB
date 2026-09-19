import { afterEach, expect, it, vi } from 'vitest';
import { getBoardIndex, getMembers, getThreadPage } from './appview';
import { getPublicProfile, bustProfileCache, resolveActor, setOutboundForTests } from './profiles';

vi.mock('$env/dynamic/private', () => ({ env: { ATMOBB_FORUM_DID: 'did:plc:current' } }));
const profile = { displayName: 'Account', signature: [{ text: 'Account signature' }], notifications: true, forumProfiles: [
  { forum: 'did:plc:current', fields: ['displayName', 'signature', 'notifications'], displayName: 'Local', notifications: false },
  { forum: 'did:plc:other', fields: ['displayName'], displayName: 'Other' },
] };

/** The shape a hardened outbound read returns. */
const reply = (body: unknown, status = 200) => ({
  status,
  headers: {},
  body: new TextEncoder().encode(JSON.stringify(body)),
});

afterEach(() => {
  vi.unstubAllGlobals();
  setOutboundForTests(null);
});

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

it('refuses a route segment that is not a syntactically valid handle', async () => {
  const outbound = vi.fn();
  setOutboundForTests(outbound);
  // An arbitrary host string must never become a request URL.
  expect(await resolveActor('127.0.0.1')).toBeNull();
  expect(await resolveActor('localhost')).toBeNull();
  expect(await resolveActor('not_a.handle')).toBeNull();
  expect(outbound).not.toHaveBeenCalled();
});

it('never reads a profile over a non-https PDS endpoint', async () => {
  const did = 'did:plc:plain-http';
  bustProfileCache(did);
  const outbound = vi.fn();
  setOutboundForTests(outbound);
  expect(await getPublicProfile(did, 'http://169.254.169.254')).toBeNull();
  expect(outbound).not.toHaveBeenCalled();
});

it('resolves cached public profiles and fails closed for unavailable notification preferences', async () => {
  const did = 'did:plc:read-test';
  bustProfileCache(did);
  const outbound = vi.fn(async () => reply({ value: profile }));
  setOutboundForTests(outbound);
  expect(await getPublicProfile(did, 'https://pds.test')).toMatchObject({ displayName: 'Local', notifications: false });
  expect(await getPublicProfile(did, 'https://pds.test', true)).not.toHaveProperty('signature');
  expect(outbound).toHaveBeenCalledTimes(1);
  bustProfileCache(did);
  outbound.mockRejectedValue(new Error('Unavailable'));
  expect(await getPublicProfile(did, 'https://pds.test')).toBeNull();
  await expect(getPublicProfile(did, 'https://pds.test', true)).rejects.toThrow('unavailable');
  outbound.mockResolvedValue(reply({ error: 'RecordNotFound' }, 400));
  expect(await getPublicProfile(did, 'https://pds.test', true)).toEqual({});
});
