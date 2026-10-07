import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withBoardWrite } from '$lib/server/board-write-lock';

const mocks = vi.hoisted(() => ({
  index: vi.fn(), get: vi.fn(), create: vi.fn(), createGiven: vi.fn(),
  put: vi.fn(), remove: vi.fn(), createSpace: vi.fn(), deleteSpace: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => 'did:plc:forum',
  getBoardIndex: mocks.index, createSpace: mocks.createSpace, deleteSpace: mocks.deleteSpace,
  spaceOfBoard: (access: { space?: string } | undefined) => access?.space ?? null,
}));
vi.mock('$lib/server/forum-repo', () => ({
  getForumRecord: mocks.get, createForumRecord: mocks.create,
  createForumRecordAsGiven: mocks.createGiven, putForumRecord: mocks.put,
  deleteForumRecord: mocks.remove,
}));
vi.mock('$lib/server/admin', () => ({ adminActor: async () => 'did:plc:admin' }));
vi.mock('$lib/server/happyview-session', () => ({ privateBoardsEnabled: () => true }));
vi.mock('$lib/server/saved-redirect', () => ({ savedRedirect: mocks.redirect }));
import { actions } from './+page.server';

const collection = 'app.atmobb.forum.board';
const uri = `at://did:plc:forum/${collection}/board`;
const access = { $type: `${collection}#space`, space: 'private-space' };
const privateValue = { $type: collection, name: 'Authoritative name', access, order: 1 };
function run(action: string, fields: Record<string, string> = {}) {
  return actions[action]!({
    request: new Request('https://forum.test/admin/boards', {
      method: 'POST', body: new URLSearchParams({ uri, name: 'Board', ...fields }),
    }),
    locals: {},
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.index.mockResolvedValue({ boards: [{ uri, value: { name: 'Stale public name' }, threadCount: 0 }], categories: [] });
  mocks.get.mockResolvedValue({ uri, cid: 'cid', value: structuredClone(privateValue) });
  mocks.createSpace.mockResolvedValue('private-space');
  mocks.createGiven.mockImplementation(async (_collection, _record, rkey) => ({ uri: `at://did:plc:forum/${collection}/${rkey}` }));
  mocks.create.mockResolvedValue({ uri });
  mocks.put.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.deleteSpace.mockResolvedValue(undefined);
});

describe('private board lifecycle actions', () => {
  it('creates the space before publishing a single, initially private record', async () => {
    await run('createBoard', { private: 'on' });
    const rkey = mocks.createSpace.mock.calls[0][0];
    expect(rkey).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.createGiven).toHaveBeenCalledWith(collection, expect.objectContaining({
      $type: collection, access, name: 'Board', createdAt: expect.any(String),
    }), rkey);
    expect(mocks.createSpace.mock.invocationCallOrder[0]).toBeLessThan(mocks.createGiven.mock.invocationCallOrder[0]);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('does not publish a board when space creation fails', async () => {
    mocks.createSpace.mockRejectedValue(new Error('timeout'));
    expect(await run('createBoard', { private: 'on' })).toMatchObject({ status: 502 });
    expect(mocks.createGiven).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
  });

  it('retains the space when private board creation has an uncertain outcome', async () => {
    mocks.createGiven.mockRejectedValue(new Error('timeout'));
    expect(await run('createBoard', { private: 'on' })).toMatchObject({
      status: 502, data: { message: expect.stringContaining('was retained') },
    });
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('leaves public creation on the existing path', async () => {
    await run('createBoard');
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.createSpace).not.toHaveBeenCalled();
  });

  it.each(['updateBoard', 'deleteBoard'])('%s waits for the posting lock before reading authoritative access', async (action) => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const held = withBoardWrite(uri, async () => {
      entered();
      await new Promise<void>((resolve) => { release = resolve; });
    });
    await started;
    const pending = run(action, { private: 'on', really: 'on' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.get).not.toHaveBeenCalled();
    release();
    await held;
    await pending;
    expect(mocks.get).toHaveBeenCalledWith(collection, 'board');
  });

  it('requires confirmation to delete a private board even with zero indexed threads', async () => {
    expect(await run('deleteBoard')).toMatchObject({
      status: 400, data: { message: expect.stringContaining('Authoritative name') },
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
  });

  it('requires confirmation to make an authoritatively private board public', async () => {
    expect(await run('updateBoard')).toMatchObject({ status: 400 });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('preserves authoritative privacy rather than copying stale indexed access', async () => {
    await run('updateBoard', { private: 'on' });
    expect(mocks.put).toHaveBeenCalledWith(collection, 'board', expect.objectContaining({ access }));
    expect(mocks.createSpace).not.toHaveBeenCalled();
  });

  it('retains a newly created space after an uncertain public-to-private write', async () => {
    mocks.get.mockResolvedValue({ uri, value: { name: 'Public' } });
    mocks.put.mockRejectedValue(new Error('timeout'));
    expect(await run('updateBoard', { private: 'on' })).toMatchObject({ status: 502 });
    expect(mocks.createSpace).toHaveBeenCalledOnce();
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
  });

  it('does not delete private content after an uncertain board deletion', async () => {
    mocks.remove.mockRejectedValue(new Error('timeout'));
    expect(await run('deleteBoard', { really: 'on' })).toMatchObject({ status: 502 });
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
  });

  it.each(['updateBoard', 'deleteBoard'])('%s restores private access after a failed space deletion', async (action) => {
    mocks.deleteSpace.mockRejectedValue(new Error('timeout'));
    expect(await run(action, { really: 'on' })).toMatchObject({
      status: 502, data: { message: expect.stringContaining('restored') },
    });
    expect(mocks.put.mock.calls.at(-1)?.[2]).toMatchObject({ access });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(['updateBoard', 'deleteBoard'])('%s reports uncertain restoration without claiming success', async (action) => {
    mocks.deleteSpace.mockRejectedValue(new Error('timeout'));
    if (action === 'updateBoard') mocks.put.mockResolvedValueOnce(undefined);
    mocks.put.mockRejectedValue(new Error('restore timeout'));
    expect(await run(action, { really: 'on' })).toMatchObject({
      status: 502, data: { message: expect.stringMatching(/posting stays blocked/i) },
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('does not undo authoritative privacy when reordering from a stale index', async () => {
    const otherUri = `at://did:plc:forum/${collection}/other`;
    mocks.index.mockResolvedValue({
      boards: [
        { uri, value: { name: 'Stale public name', order: 0 }, threadCount: 0 },
        { uri: otherUri, value: { name: 'Other', order: 1 }, threadCount: 0 },
      ],
      categories: [],
    });
    await run('moveBoard', { dir: 'down' });
    expect(mocks.put).toHaveBeenCalledWith(collection, 'board', expect.objectContaining({ access, order: 1 }));
  });
});
