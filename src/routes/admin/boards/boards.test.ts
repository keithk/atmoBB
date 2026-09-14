import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  create: vi.fn(), put: vi.fn(),
  value: { name: 'Music', emoji: '🎵', color: '#123456', topic: 'music' },
}));
const uri = 'at://did:plc:forum/app.atmobb.forum.board/music';
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => 'did:plc:forum',
  getBoardIndex: async () => ({ boards: [{ uri, value: state.value, threadCount: 0 }] }),
  spaceOfBoard: () => undefined,
}));
vi.mock('$lib/server/admin', () => ({ adminActor: async () => true }));
vi.mock('$lib/server/happyview-session', () => ({ privateBoardsEnabled: () => false }));
vi.mock('$lib/server/forum-repo', () => ({ createForumRecord: state.create, putForumRecord: state.put }));
vi.mock('$lib/server/saved-redirect', () => ({ savedRedirect: async () => {} }));
import { actions } from './+page.server';

const event = (emoji: string) => ({
  locals: {},
  request: new Request('http://localhost/admin/boards', {
    method: 'POST', body: new URLSearchParams({ uri, name: 'Music', color: '#123456', emoji }),
  }),
}) as never;

beforeEach(() => {
  state.create.mockReset().mockResolvedValue({ uri });
  state.put.mockReset();
});

it('persists a chosen emoji on creation and replacement without changing color or topic', async () => {
  await actions.createBoard!(event('👩🏽‍💻'));
  expect(state.create).toHaveBeenCalledWith('app.atmobb.forum.board', expect.objectContaining({ emoji: '👩🏽‍💻', color: '#123456' }));
  await actions.updateBoard!(event('🎸'));
  expect(state.put).toHaveBeenCalledWith('app.atmobb.forum.board', 'music', expect.objectContaining({ emoji: '🎸', color: '#123456', topic: 'music' }));
});

it('omits blank emoji on creation and removes it from existing records', async () => {
  await actions.createBoard!(event(''));
  expect(state.create.mock.calls[0][1]).not.toHaveProperty('emoji');
  await actions.updateBoard!(event(''));
  expect(state.put.mock.calls[0][2]).not.toHaveProperty('emoji');
  expect(state.put.mock.calls[0][2]).toMatchObject({ color: '#123456', topic: 'music' });
  expect(state.value.emoji).toBe('🎵');
});

it('rejects invalid emoji before writing', async () => {
  expect(await actions.createBoard!(event('🎵🎸'))).toMatchObject({ status: 400 });
  expect(await actions.updateBoard!(event('music'))).toMatchObject({ status: 400 });
  expect(state.create).not.toHaveBeenCalled();
  expect(state.put).not.toHaveBeenCalled();
});
