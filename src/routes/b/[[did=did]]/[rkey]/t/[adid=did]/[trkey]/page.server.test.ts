import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  access: vi.fn(), member: vi.fn(), read: vi.fn(), board: vi.fn(),
  create: vi.fn(), update: vi.fn(), remove: vi.fn(), ban: vi.fn(),
  refusal: vi.fn(), notify: vi.fn(),
}));
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => 'did:plc:forum',
  THREAD_NSID: 'app.atmobb.discussion.thread',
  boardUri: (rkey: string, did = 'did:plc:forum') => `at://${did}/app.atmobb.forum.board/${rkey}`,
  getBoardAccess: mocks.access, isSpaceMember: mocks.member, getBoardThreads: mocks.board,
  resolveHandle: async () => 'member.test',
}));
vi.mock('$lib/server/space-read', () => ({ readSpaceThreadPage: mocks.read }));
vi.mock('$lib/server/pds', () => ({
  createReply: mocks.create, updatePost: mocks.update, deletePost: mocks.remove,
}));
vi.mock('$lib/server/profiles', () => ({ presenceFor: () => null }));
vi.mock('$lib/server/richtext', () => ({
  attachImages: (body: unknown) => body, resolveBodyImages: async () => {},
}));
vi.mock('$lib/server/mentions', () => ({ addMentionFacets: async (body: unknown) => body }));
vi.mock('$lib/server/standing', () => ({ bannedFrom: mocks.ban, banMessage: () => 'Banned' }));
vi.mock('$lib/server/membership', () => ({ refuseUnlessMember: mocks.refusal }));
vi.mock('$lib/server/notify/visit', () => ({ handleNotifyVisit: () => {} }));
vi.mock('$lib/server/notify/store', () => ({ neverAskedAboutNotifications: async () => false }));
vi.mock('$lib/server/notify/dispatch', () => ({ notifyForPost: mocks.notify }));
import { actions, load } from './+page.server';

const viewer = { did: 'did:plc:member', handle: 'member.test' };
// Neither the instance authority nor the space rkey can be derived from the board.
const space = 'at://did:plc:instance/space/private/opaque-space';
const boardUri = 'at://did:plc:forum/app.atmobb.forum.board/board';
const threadUri = `${space}/${viewer.did}/app.atmobb.discussion.thread/thread`;
const replyUri = `${space}/${viewer.did}/app.atmobb.discussion.reply/reply`;
const boardPath = '/b/board';
const threadPath = `${boardPath}/t/${viewer.did}/thread`;

function event(fields: Record<string, string> = {}, query = '') {
  return {
    params: { rkey: 'board', adid: viewer.did, trkey: 'thread' },
    locals: { user: viewer },
    url: new URL(`https://forum.test${threadPath}${query}`),
    isDataRequest: false, setHeaders: vi.fn(),
    request: new Request(`https://forum.test${threadPath}`, {
      method: 'POST', body: new URLSearchParams({ body: 'Hello', threadCid: 'thread-cid', ...fields }),
    }),
  };
}
function run(action: string, fields: Record<string, string> = {}) {
  return actions[action]!(event(fields) as never);
}
function expectNoContentIO() {
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.board).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(space);
  mocks.member.mockResolvedValue(true);
  mocks.board.mockResolvedValue({ board: { name: 'Private board' } });
  mocks.read.mockResolvedValue({
    thread: {
      uri: threadUri, cid: 'thread-cid', author: viewer.did, authorStamps: [],
      value: { title: 'Private thread', body: [] },
    },
    replies: [],
  });
  mocks.create.mockResolvedValue({ uri: replyUri });
  mocks.ban.mockResolvedValue(null);
  mocks.refusal.mockResolvedValue(null);
});

describe('private thread route authoritative space boundary', () => {
  it('uses returned authority for membership, member reads, reply targets and editing links', async () => {
    const result = await load(event({}, '?to=thread&edit=thread') as never);
    expect(mocks.access).toHaveBeenCalledWith(boardUri);
    expect(mocks.member).toHaveBeenCalledExactlyOnceWith(space, viewer.did);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(viewer.did, threadUri);
    expect(result).toMatchObject({
      threadUri, boardName: 'Private board',
      replyTo: { uri: threadUri, cid: 'thread-cid', author: viewer.did },
      editing: { uri: threadUri, title: 'Private thread' },
    });
  });

  it('posts to returned authority and omits a redundant thread parent', async () => {
    expect(await run('reply', { parentUri: threadUri, parentCid: 'thread-cid' })).toEqual({ posted: true });
    expect(mocks.access).toHaveBeenCalledWith(boardUri);
    expect(mocks.member).toHaveBeenCalledExactlyOnceWith(space, viewer.did);
    expect(mocks.create).toHaveBeenCalledWith(viewer.did, {
      thread: { uri: threadUri, cid: 'thread-cid' }, body: expect.any(Array),
    });
    expect(mocks.read).toHaveBeenCalledWith(viewer.did, threadUri);
    expect(mocks.ban).toHaveBeenCalledWith(viewer.did, boardUri, { strict: true });
  });

  it.each(['load', 'reply', 'edit', 'delete'])('%s stops before content IO when access is null', async (operation) => {
    mocks.access.mockResolvedValue(null);
    const pending = operation === 'load' ? load(event() as never) : run(operation, { uri: threadUri });
    await expect(pending).rejects.toMatchObject({ status: 404 });
    expect(mocks.member).not.toHaveBeenCalled();
    expectNoContentIO();
  });

  it.each(['load', 'reply', 'edit', 'delete'])('%s stops before content IO when authoritative access rejects', async (operation) => {
    const unavailable = new Error('authoritative access unavailable');
    mocks.access.mockRejectedValue(unavailable);
    const pending = operation === 'load' ? load(event() as never) : run(operation, { uri: threadUri });
    await expect(pending).rejects.toBe(unavailable);
    expect(mocks.member).not.toHaveBeenCalled();
    expectNoContentIO();
  });

  it('redirects a nonmember load to the locked board without reading content', async () => {
    mocks.member.mockResolvedValue(false);
    await expect(load(event() as never)).rejects.toMatchObject({ status: 303, location: boardPath });
    expect(mocks.member).toHaveBeenCalledWith(space, viewer.did);
    expectNoContentIO();
  });

  it('denies a nonmember reply before standing checks or writes', async () => {
    mocks.member.mockResolvedValue(false);
    expect(await run('reply')).toMatchObject({
      status: 403, data: { message: 'Only members of this board can reply.' },
    });
    expect(mocks.member).toHaveBeenCalledWith(space, viewer.did);
    expect(mocks.ban).not.toHaveBeenCalled();
    expect(mocks.refusal).not.toHaveBeenCalled();
    expectNoContentIO();
  });

  it.each([
    [threadUri, `${boardPath}?deleted=1`],
    [replyUri, `${threadPath}?deleted=1`],
  ])('deletes %s and distinguishes the authoritative thread target', async (uri, location) => {
    await expect(run('delete', { uri })).rejects.toMatchObject({ status: 303, location });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(viewer.did, uri);
    expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
  });

  it('passes the authoritative edit target to the write boundary and returns to the thread', async () => {
    await expect(run('edit', { uri: threadUri, title: 'Edited' })).rejects.toMatchObject({
      status: 303, location: `${threadPath}?saved=1#post-thread`,
    });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(viewer.did, threadUri, {
      title: 'Edited', body: expect.any(Array),
    });
    expect(mocks.access).toHaveBeenCalledWith(boardUri);
  });
});
