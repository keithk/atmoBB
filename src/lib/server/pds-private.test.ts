import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createThread } from './pds';
import { withBoardWrite } from './board-write-lock';

const state = vi.hoisted(() => ({
  private: true,
  publicCreate: vi.fn(),
  space: 'at://did:web:happyview.test/space/app.atmobb.forum.privateBoard/custom',
}));
const boardUri = 'at://did:plc:forum/app.atmobb.forum.board/board';
vi.mock('$env/dynamic/private', () => ({ env: { ATMOBB_FORUM_DID: 'did:plc:forum' } }));
vi.mock('./happyview-session', () => ({ mintSessionCookie: (did: string) => `session:${did}` }));
vi.mock('./atproto-oauth', () => ({
  agentFor: async () => ({ com: { atproto: { repo: { createRecord: state.publicCreate } } } }),
}));
vi.mock('./forum-repo', () => ({
  getForumRecord: async () => ({
    uri: 'at://did:plc:forum/app.atmobb.forum.board/board', cid: 'cid',
    value: { name: 'Board', ...(state.private ? { access: { $type: 'app.atmobb.forum.board#space', space: state.space } } : {}) },
  }),
}));
beforeEach(() => {
  state.private = true;
  state.publicCreate.mockReset().mockResolvedValue({ data: { uri: 'public', cid: 'cid' } });
});
afterEach(() => vi.unstubAllGlobals());

function engine() {
  const fetch = vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname.endsWith('listSpaces')) {
      return Response.json({ spaces: state.private ? [{ uri: state.space, isOwner: true }] : [] });
    }
    expect(url.pathname).toBe('/xrpc/com.atproto.space.createRecord');
    expect(JSON.parse(init.body as string).space).toBe(state.space);
    return Response.json({ uri: `${state.space}/did:plc:member/app.atmobb.discussion.thread/post`, cid: 'cid' });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const post = () => createThread('did:plc:member', { board: boardUri, title: 'Private', body: [] });

it('writes to the actual instance-authority space and never the public PDS', async () => {
  engine();
  expect((await post()).uri).toContain(state.space);
  expect(state.publicCreate).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 500])('cannot fall back to public storage after a space inventory %s', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unavailable' }, { status })));
  await expect(post()).rejects.toMatchObject({ status });
  expect(state.publicCreate).not.toHaveBeenCalled();
});

it('allows the public path only when authoritative metadata and the full inventory agree', async () => {
  state.private = false;
  engine();
  expect((await post()).uri).toBe('public');
  expect(state.publicCreate).toHaveBeenCalledOnce();
});

it('checks privacy after an in-flight transition, not before it', async () => {
  state.private = false;
  const fetch = engine();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const transition = withBoardWrite(boardUri, async () => {
    await gate;
    state.private = true;
  });
  const posting = post();
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  finish();
  await transition;
  expect((await posting).uri).toContain(state.space);
  expect(state.publicCreate).not.toHaveBeenCalled();
});
