import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The action endpoint over the real registry and binding cache on disk. The
// seams are the appview, bans, the extensions lock, and the extension host,
// whose rate limits have their own tests.

const FORUM = 'did:plc:forumaccount';
const MEMBER = 'did:plc:member';
const APP = 'https://forum.test';
const INSTALL = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'BBBBBBBBBBBBBBBBBBBBBB';
const THREAD = 'at://did:plc:author/app.atmobb.discussion.thread/3kgame';
const BOARD = `at://${FORUM}/app.atmobb.forum.board/games`;
const CLIENT = '203.0.113.9';

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  lockHeld: true,
  getThreadPage: vi.fn(),
  getBoardAccess: vi.fn(),
  bannedFrom: vi.fn(),
  dispatchAction: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => FORUM,
  THREAD_NSID: 'app.atmobb.discussion.thread',
  getThreadPage: state.getThreadPage,
  getBoardAccess: state.getBoardAccess,
}));
vi.mock('$lib/server/forum-repo', () => ({ listForumRecords: async () => [] }));
vi.mock('$lib/server/standing', () => ({ bannedFrom: state.bannedFrom, banMessage: () => "You're banned from posting here." }));
vi.mock('$lib/server/extensions/lock', () => ({ extensionsLockHeld: () => state.lockHeld }));
vi.mock('$lib/server/extensions/host', async () => {
  class ExtensionCallError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { ExtensionCallError, dispatchAction: state.dispatchAction };
});
import { ExtensionCallError } from '$lib/server/extensions/host';
import { POST } from './+server';

let directory: string;

async function writeRegistry(installState: 'active' | 'disabled' = 'active') {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const installs = [INSTALL, OTHER].map((id) => ({ id, normalizedUrl: `https://git.example/jack/${id}`, state: installState, manifest: { name: 'Diplomacy', collections: [] } }));
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify({ installs }));
}

async function bindThread(installId: string) {
  const binding = { thread: THREAD, installId, uri: `at://${FORUM}/app.atmobb.extension.binding/x`, extension: `https://git.example/jack/${installId}`, attachedBy: 'did:plc:staff', createdAt: '' };
  await writeFile(join(directory, 'extensions', 'bindings.json'), JSON.stringify({ bindings: { [THREAD]: binding } }));
}

interface ActionRequest {
  did?: string | null;
  origin?: string | null;
  contentType?: string;
  body?: unknown;
  install?: string;
  query?: string;
}

async function act({ did = MEMBER, origin = APP, contentType = 'application/json', body = { thread: THREAD, action: 'move', input: { army: 'Paris' } }, install = INSTALL, query = '' }: ActionRequest = {}) {
  const headers = new Headers({ 'content-type': contentType });
  if (origin !== null) headers.set('origin', origin);
  const request = new Request(`${APP}/x/${install}/action${query}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const getClientAddress = vi.fn(() => CLIENT);
  const event = { request, params: { install }, locals: { user: did ? { did, handle: 'someone.test' } : null }, url: new URL(request.url), getClientAddress };
  const response = await POST(event as never);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return { status: response.status, body: await response.json(), getClientAddress };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-action-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.env.ATMOBB_APP_URL = APP;
  state.lockHeld = true;
  vi.clearAllMocks();
  state.getThreadPage.mockImplementation(async (uri: string) => ({ thread: { uri, hidden: false, value: { board: BOARD } }, replies: [], replyCount: 0 }));
  state.getBoardAccess.mockResolvedValue(null);
  state.bannedFrom.mockResolvedValue(undefined);
  state.dispatchAction.mockResolvedValue({ moved: true });
  await writeRegistry();
  await bindThread(INSTALL);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

describe('POST /x/[install]/action', () => {
  it('runs a thread action for a signed-in member of a bound thread on a public board', async () => {
    expect(await act()).toMatchObject({ status: 200, body: { value: { moved: true } } });
    expect(state.dispatchAction).toHaveBeenCalledExactlyOnceWith(INSTALL, MEMBER, { uri: THREAD }, 'move', { army: 'Paris' }, {});
    expect(state.bannedFrom).toHaveBeenCalledWith(MEMBER, BOARD, { strict: true });
  });

  it('refuses a wrong or missing Origin, a body that is not JSON, and a malformed request', async () => {
    expect((await act({ origin: null })).status).toBe(403);
    expect((await act({ origin: 'https://evil.test' })).status).toBe(403);
    expect((await act({ origin: 'https://forum.test.evil.test' })).status).toBe(403);
    expect((await act({ origin: 'null' })).status).toBe(403);
    expect((await act({ contentType: 'application/x-www-form-urlencoded', body: 'thread=x&action=move' })).status).toBe(415);
    expect((await act({ contentType: 'text/plain' })).status).toBe(415);
    expect((await act({ body: '{not json' })).status).toBe(400);
    expect((await act({ body: { thread: THREAD } })).status).toBe(400);
    expect((await act({ body: { action: 'move' } })).status).toBe(400);
    expect((await act({ body: { thread: 7, action: 'move' } })).status).toBe(400);
    expect((await act({ body: { thread: THREAD, action: '' } })).status).toBe(400);
    expect(state.dispatchAction).not.toHaveBeenCalled();
    expect((await act({ contentType: 'application/json; charset=utf-8' })).status).toBe(200);
  });

  it('takes the action only from the body, never the URL', async () => {
    expect((await act({ body: { thread: THREAD }, query: '?action=move&input=%7B%7D' })).status).toBe(400);
    expect(state.dispatchAction).not.toHaveBeenCalled();
  });

  it('refuses a thread that is unbound or bound to another install, and an install that was disabled', async () => {
    await writeFile(join(directory, 'extensions', 'bindings.json'), JSON.stringify({ bindings: {} }));
    expect((await act()).status).toBe(404);
    await bindThread(OTHER);
    expect((await act()).status).toBe(404);
    await bindThread(INSTALL);
    await writeRegistry('disabled');
    expect((await act()).status).toBe(404);
    expect(state.dispatchAction).not.toHaveBeenCalled();
  });

  it('refuses a thread whose board went members-only, and one that was hidden', async () => {
    state.getBoardAccess.mockResolvedValue(`at://${FORUM}/space/app.atmobb.forum.privateBoard/games`);
    expect(await act()).toMatchObject({ status: 403, body: { message: expect.stringContaining('members-only') } });
    state.getBoardAccess.mockResolvedValue(null);
    state.getThreadPage.mockResolvedValueOnce({ thread: { uri: THREAD, hidden: true, value: { board: BOARD } }, replies: [] });
    expect((await act()).status).toBe(403);
    expect(state.dispatchAction).not.toHaveBeenCalled();
  });

  it('checks the binding’s access on every call', async () => {
    await act();
    await act();
    expect(state.getBoardAccess).toHaveBeenCalledTimes(2);
  });

  it('refuses a banned member, and fails closed when bans cannot be read', async () => {
    state.bannedFrom.mockResolvedValue({ subject: MEMBER, board: BOARD });
    expect(await act()).toMatchObject({ status: 403, body: { message: expect.stringContaining('banned') } });
    expect((await act({ body: { thread: null, action: 'move' } })).status).toBe(403);
    state.bannedFrom.mockRejectedValue(new Error('appview down'));
    expect((await act()).status).toBe(502);
    expect(state.dispatchAction).not.toHaveBeenCalled();
  });

  it('refuses a signed-out visitor’s thread action', async () => {
    expect(await act({ did: null })).toMatchObject({ status: 401, body: { code: 'sign_in_required' } });
    expect(state.dispatchAction).not.toHaveBeenCalled();
  });

  it('runs a signed-out visitor’s standalone action, counted by client address', async () => {
    const response = await act({ did: null, body: { thread: null, action: 'replay', input: { game: 'spring-1901' } } });
    expect(response).toMatchObject({ status: 200, body: { value: { moved: true } } });
    expect(response.getClientAddress).toHaveBeenCalled();
    expect(state.dispatchAction).toHaveBeenCalledExactlyOnceWith(INSTALL, null, null, 'replay', { game: 'spring-1901' }, { client: CLIENT });
    expect(state.bannedFrom).not.toHaveBeenCalled();
  });

  it('runs a signed-in standalone action without a client address', async () => {
    const response = await act({ body: { thread: null, action: 'replay' } });
    expect(response.status).toBe(200);
    expect(response.getClientAddress).not.toHaveBeenCalled();
    expect(state.dispatchAction).toHaveBeenCalledExactlyOnceWith(INSTALL, MEMBER, null, 'replay', null, {});
  });

  it('answers host refusals with their status and code, keeping other failures generic', async () => {
    for (const [code, status] of [
      ['rate_limited', 429],
      ['unavailable', 503],
      ['not_installed', 404],
      ['disabled', 404],
      ['no_handler', 404],
      ['timeout', 502],
      ['failed', 502],
    ] as const) {
      state.dispatchAction.mockRejectedValueOnce(new ExtensionCallError(code, `host said ${code}`));
      expect(await act({ body: { thread: null, action: 'move' } }), code).toMatchObject({ status, body: { code, message: `host said ${code}` } });
    }
    state.dispatchAction.mockRejectedValueOnce(new Error('SENTINEL internal detail'));
    const failed = await act({ body: { thread: null, action: 'move' } });
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.body)).not.toContain('SENTINEL');
  });

  it('refuses cleanly while extensions are off or this server lacks the lock', async () => {
    state.env.ATMOBB_EXTENSIONS = 'off';
    expect((await act()).status).toBe(503);
    delete state.env.ATMOBB_EXTENSIONS;
    state.lockHeld = false;
    expect((await act({ body: { thread: null, action: 'move' } })).status).toBe(503);
    expect(state.dispatchAction).not.toHaveBeenCalled();
  });
});
