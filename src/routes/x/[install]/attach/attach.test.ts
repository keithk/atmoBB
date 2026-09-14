import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The attach endpoint over the real registry and binding cache on disk. The
// seams are the forum repo (in memory), the appview, staff lookups, the
// extensions lock, and the extension host.

const FORUM = 'did:plc:forumaccount';
const STAFF = 'did:plc:staff';
const MEMBER = 'did:plc:member';
const APP = 'https://forum.test';
const BINDING = 'app.atmobb.extension.binding';
const DIPLOMACY_URL = 'https://git.example/jack/diplomacy';
const INSTALL = 'AAAAAAAAAAAAAAAAAAAAAA';
const THREAD = 'at://did:plc:author/app.atmobb.discussion.thread/3kgame';
const BOARD = `at://${FORUM}/app.atmobb.forum.board/games`;

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  repo: new Map<string, { uri: string; cid: string; value: Record<string, unknown> }>(),
  staff: new Set<string>(),
  lockHeld: true,
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
  getThreadPage: vi.fn(),
  getBoardAccess: vi.fn(),
  hasHandler: vi.fn(),
  dispatchAttach: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => FORUM,
  THREAD_NSID: 'app.atmobb.discussion.thread',
  getThreadPage: state.getThreadPage,
  getBoardAccess: state.getBoardAccess,
}));
vi.mock('$lib/server/forum-repo', () => ({
  forumWriteErrorMessage: (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback,
  createForumRecordAsGiven: state.createRecord,
  deleteForumRecord: state.deleteRecord,
  getForumRecord: async (collection: string, rkey: string) => state.repo.get(`at://${FORUM}/${collection}/${rkey}`) ?? null,
  listForumRecords: async (collection: string) => [...state.repo.values()].filter((record) => record.uri.includes(`/${collection}/`)),
}));
vi.mock('$lib/server/admin', () => ({ canModerateForum: async (did: string | null) => !!did && state.staff.has(did) }));
vi.mock('$lib/server/extensions/lock', () => ({ extensionsLockHeld: () => state.lockHeld }));
vi.mock('$lib/server/extensions/host', async () => {
  // The real error class, without loading the runtime.
  class ExtensionCallError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { ExtensionCallError, hasHandler: state.hasHandler, dispatchAttach: state.dispatchAttach };
});
import { ExtensionCallError } from '$lib/server/extensions/host';
import { bindingFor, bindingRkey } from '$lib/server/extensions/bindings';
import { POST } from './+server';

let directory: string;

async function writeInstall(installState: 'active' | 'disabled' = 'active') {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const install = { id: INSTALL, normalizedUrl: DIPLOMACY_URL, gitUrl: `${DIPLOMACY_URL}.git`, state: installState, manifest: { name: 'Diplomacy', collections: [] } };
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify({ installs: [install] }));
}

interface AttachRequest {
  did?: string | null;
  origin?: string | null;
  contentType?: string;
  body?: unknown;
  install?: string;
}

async function attach({ did = STAFF, origin = APP, contentType = 'application/json', body = { thread: THREAD, params: { players: 7 } }, install = INSTALL }: AttachRequest = {}) {
  const headers = new Headers({ 'content-type': contentType });
  if (origin !== null) headers.set('origin', origin);
  const request = new Request(`${APP}/x/${install}/attach`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const event = { request, params: { install }, locals: { user: did ? { did, handle: 'someone.test' } : null }, url: new URL(request.url) };
  const response = await POST(event as never);
  return { status: response.status, body: await response.json() };
}

const bindingKey = `at://${FORUM}/${BINDING}/${bindingRkey(THREAD)}`;

async function cacheFile(): Promise<string> {
  return readFile(join(directory, 'extensions', 'bindings.json'), 'utf8').catch(() => '');
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-attach-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.env.ATMOBB_APP_URL = APP;
  state.repo = new Map();
  state.staff = new Set([STAFF]);
  state.lockHeld = true;
  vi.clearAllMocks();
  state.createRecord.mockImplementation(async (collection: string, record: Record<string, unknown>, rkey: string) => {
    const uri = `at://${FORUM}/${collection}/${rkey}`;
    if (state.repo.has(uri)) throw new Error('Record already exists');
    state.repo.set(uri, { uri, cid: `bafy${rkey}`, value: record });
    return { uri, cid: `bafy${rkey}` };
  });
  state.deleteRecord.mockImplementation(async (uri: string) => void state.repo.delete(uri));
  state.getThreadPage.mockImplementation(async (uri: string) => ({ thread: { uri, hidden: false, value: { board: BOARD } }, replies: [], replyCount: 0 }));
  state.getBoardAccess.mockResolvedValue(null);
  state.hasHandler.mockResolvedValue(true);
  state.dispatchAttach.mockResolvedValue({ game: 'started' });
  await writeInstall();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

const nothingHappened = async () => {
  expect(state.createRecord).not.toHaveBeenCalled();
  expect(state.dispatchAttach).not.toHaveBeenCalled();
  expect(await bindingFor(THREAD)).toBeNull();
};

describe('POST /x/[install]/attach', () => {
  it('lets staff attach to a thread on a public board: writes the host binding record, caches it, then runs the extension’s attach', async () => {
    const response = await attach();

    expect(response).toEqual({ status: 200, body: { binding: { thread: THREAD, installId: INSTALL, uri: bindingKey }, result: { game: 'started' } } });
    expect(state.createRecord).toHaveBeenCalledExactlyOnceWith(
      BINDING,
      { $type: BINDING, thread: THREAD, extension: DIPLOMACY_URL, attachedBy: STAFF, createdAt: expect.any(String) },
      bindingRkey(THREAD),
    );
    expect(state.dispatchAttach).toHaveBeenCalledExactlyOnceWith(INSTALL, STAFF, { uri: THREAD }, { players: 7 });
    expect(state.createRecord.mock.invocationCallOrder[0]).toBeLessThan(state.dispatchAttach.mock.invocationCallOrder[0]);
    expect(await bindingFor(THREAD)).toMatchObject({ installId: INSTALL, thread: THREAD, attachedBy: STAFF, uri: bindingKey });
  });

  it('refuses signed-out viewers and members who are not staff', async () => {
    expect(await attach({ did: null })).toMatchObject({ status: 401, body: { message: expect.any(String) } });
    expect(await attach({ did: MEMBER })).toMatchObject({ status: 403, body: { message: expect.stringContaining('staff') } });
    await nothingHappened();
  });

  it('refuses a wrong or missing Origin and a body that is not JSON', async () => {
    expect((await attach({ origin: 'https://evil.test' })).status).toBe(403);
    expect((await attach({ origin: null })).status).toBe(403);
    expect((await attach({ origin: 'https://forum.test.evil.test' })).status).toBe(403);
    expect((await attach({ contentType: 'text/plain' })).status).toBe(415);
    expect((await attach({ contentType: 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await attach({ body: '{not json' })).status).toBe(400);
    expect((await attach({ body: { params: {} } })).status).toBe(400);
    await nothingHappened();
    expect((await attach({ contentType: 'application/json; charset=utf-8' })).status).toBe(200);
  });

  it('refuses a thread on a members-only board, explaining why', async () => {
    state.getBoardAccess.mockResolvedValue(`at://${FORUM}/space/app.atmobb.forum.privateBoard/games`);
    expect(await attach()).toMatchObject({ status: 403, body: { message: expect.stringContaining('members-only') } });
    expect(state.getBoardAccess).toHaveBeenCalledWith(BOARD);
    await nothingHappened();
  });

  it('refuses a hidden or removed thread', async () => {
    state.getThreadPage.mockResolvedValueOnce({ thread: { uri: THREAD, hidden: true, value: { board: BOARD } }, replies: [] });
    expect(await attach()).toMatchObject({ status: 403, body: { message: expect.stringContaining('hidden') } });
    state.getThreadPage.mockResolvedValueOnce({ replies: [] });
    expect((await attach()).status).toBe(404);
    await nothingHappened();
  });

  it('refuses a thread that is already bound', async () => {
    expect((await attach()).status).toBe(200);
    expect(await attach()).toMatchObject({ status: 409, body: { message: expect.stringContaining('already') } });
    expect(state.createRecord).toHaveBeenCalledTimes(1);
    expect(state.dispatchAttach).toHaveBeenCalledTimes(1);
  });

  it('refuses a thread whose binding record exists for an extension that is no longer installed', async () => {
    state.repo.set(bindingKey, { uri: bindingKey, cid: 'bafyold', value: { $type: BINDING, thread: THREAD, extension: 'https://git.example/jack/gone' } });
    expect(await attach()).toMatchObject({ status: 409, body: { message: expect.stringContaining('already') } });
    expect(state.createRecord).not.toHaveBeenCalled();
    expect(state.dispatchAttach).not.toHaveBeenCalled();
  });

  it('removes the binding record and cache entry when the extension’s attach handler fails', async () => {
    state.dispatchAttach.mockRejectedValue(new ExtensionCallError('failed', 'The extension failed while handling the call'));
    const response = await attach();

    expect(response.status).toBe(422);
    expect(response.body.message).toContain('Diplomacy');
    expect(response.body.message).toContain('The extension failed while handling the call');
    expect(state.deleteRecord).toHaveBeenCalledExactlyOnceWith(bindingKey);
    expect(state.repo.size).toBe(0);
    expect(await bindingFor(THREAD)).toBeNull();
    expect(await cacheFile()).not.toContain(THREAD);
  });

  it('leaves no cache entry and never calls the extension when the binding record write fails', async () => {
    state.createRecord.mockRejectedValue(new Error('The forum account needs updated permissions.'));
    const response = await attach();

    expect(response).toMatchObject({ status: 502, body: { message: expect.stringContaining('permissions') } });
    expect(state.dispatchAttach).not.toHaveBeenCalled();
    expect(await bindingFor(THREAD)).toBeNull();
    expect(await cacheFile()).not.toContain(THREAD);
  });

  it('refuses an extension without an attach handler, before writing anything', async () => {
    state.hasHandler.mockResolvedValue(false);
    expect(await attach()).toMatchObject({ status: 422, body: { message: expect.stringContaining("can't be attached") } });
    expect(state.hasHandler).toHaveBeenCalledWith(INSTALL, 'attach');
    await nothingHappened();
  });

  it('refuses while extensions are off or this server lacks the lock, and for a missing or disabled install', async () => {
    state.env.ATMOBB_EXTENSIONS = 'off';
    expect((await attach()).status).toBe(503);
    delete state.env.ATMOBB_EXTENSIONS;
    state.lockHeld = false;
    expect((await attach()).status).toBe(503);
    state.lockHeld = true;

    expect((await attach({ install: 'BBBBBBBBBBBBBBBBBBBBBB' })).status).toBe(404);
    await writeInstall('disabled');
    expect(await attach()).toMatchObject({ status: 409, body: { message: expect.stringContaining('disabled') } });
    await nothingHappened();
  });
});
