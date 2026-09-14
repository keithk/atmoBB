import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// What the thread page shows for extensions, over the real registry and
// binding cache on disk. The seams are the appview, staff lookups, the
// extensions lock, and the host's handler check.

const FORUM = 'did:plc:forumaccount';
const STAFF = 'did:plc:staff';
const MEMBER = 'did:plc:member';
const INSTALL = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'BBBBBBBBBBBBBBBBBBBBBB';
const THREAD = 'at://did:plc:author/app.atmobb.discussion.thread/3kgame';
const BOARD = `at://${FORUM}/app.atmobb.forum.board/games`;

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  lockHeld: true,
  staff: new Set<string>(),
  getThreadPage: vi.fn(),
  getBoardAccess: vi.fn(),
  hasHandler: vi.fn(),
  endorsementFor: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('../appview', () => ({
  FORUM_DID: () => FORUM,
  THREAD_NSID: 'app.atmobb.discussion.thread',
  getThreadPage: state.getThreadPage,
  getBoardAccess: state.getBoardAccess,
}));
vi.mock('../forum-repo', () => ({ listForumRecords: async () => [] }));
vi.mock('../admin', () => ({ canModerateForum: async (did: string | null) => !!did && state.staff.has(did) }));
vi.mock('./lock', () => ({ extensionsLockHeld: () => state.lockHeld }));
vi.mock('./host', () => ({ hasHandler: state.hasHandler }));
vi.mock('./endorsement', () => ({ endorsementFor: state.endorsementFor }));

import { threadExtension } from './panels';

let directory: string;

interface InstallSpec {
  id: string;
  state?: 'active' | 'disabled';
  ui?: { entry: string } | null;
  name?: string;
}

async function writeInstalls(...specs: InstallSpec[]) {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const installs = specs.map(({ id, state: installState = 'active', ui = { entry: 'ui/index.html' }, name = `Extension ${id.slice(0, 1)}` }) => ({
    id,
    sha: 'abc',
    normalizedUrl: `https://git.example/jack/${id}`,
    state: installState,
    manifest: { name, collections: [], ...(ui ? { ui } : {}) },
  }));
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify({ installs }));
}

async function bindThread(installId: string) {
  const binding = { thread: THREAD, installId, uri: `at://${FORUM}/app.atmobb.extension.binding/x`, extension: `https://git.example/jack/${installId}`, attachedBy: STAFF, createdAt: '' };
  await writeFile(join(directory, 'extensions', 'bindings.json'), JSON.stringify({ bindings: { [THREAD]: binding } }));
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-panels-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.lockHeld = true;
  state.staff = new Set([STAFF]);
  vi.clearAllMocks();
  state.getThreadPage.mockImplementation(async (uri: string) => ({ thread: { uri, hidden: false, value: { board: BOARD } }, replies: [] }));
  state.getBoardAccess.mockResolvedValue(null);
  state.hasHandler.mockResolvedValue(true);
  state.endorsementFor.mockResolvedValue({ status: 'unverified' });
  await writeInstalls({ id: INSTALL, name: 'Diplomacy' }, { id: OTHER, name: 'Chess' });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

const noNetwork = () => {
  expect(state.getThreadPage).not.toHaveBeenCalled();
  expect(state.getBoardAccess).not.toHaveBeenCalled();
};

describe('threadExtension', () => {
  it('shows the bound extension’s panel after checking the thread is still public', async () => {
    await bindThread(INSTALL);
    expect(await threadExtension({ thread: THREAD, viewerDid: MEMBER, boardPublic: true })).toEqual({
      panel: { installId: INSTALL, name: 'Diplomacy', entry: 'index.html', endorsement: 'unverified' },
      attach: [],
    });
    expect(state.getBoardAccess).toHaveBeenCalledWith(BOARD);
  });

  it('marks the panel endorsed only when the directory reviewed the running release', async () => {
    await bindThread(INSTALL);
    state.endorsementFor.mockResolvedValueOnce({ status: 'endorsed', reviewed: true });
    expect((await threadExtension({ thread: THREAD, viewerDid: MEMBER, boardPublic: true }))?.panel?.endorsement).toBe('endorsed');
    state.endorsementFor.mockResolvedValueOnce({ status: 'endorsed', reviewed: false });
    expect((await threadExtension({ thread: THREAD, viewerDid: MEMBER, boardPublic: true }))?.panel?.endorsement).toBe('unverified');
  });

  it('shows the panel to signed-out readers too', async () => {
    await bindThread(INSTALL);
    expect((await threadExtension({ thread: THREAD, viewerDid: null, boardPublic: true }))?.panel).toMatchObject({ installId: INSTALL });
  });

  it('shows no panel once the bound thread’s board went members-only', async () => {
    await bindThread(INSTALL);
    state.getBoardAccess.mockResolvedValue(`at://${FORUM}/space/app.atmobb.forum.privateBoard/games`);
    expect(await threadExtension({ thread: THREAD, viewerDid: MEMBER, boardPublic: true })).toEqual({ panel: null, attach: [] });
  });

  it('shows no panel for an install without a UI', async () => {
    await writeInstalls({ id: INSTALL, ui: null });
    await bindThread(INSTALL);
    expect(await threadExtension({ thread: THREAD, viewerDid: MEMBER, boardPublic: true })).toEqual({ panel: null, attach: [] });
  });

  it('makes no network call for an unbound thread', async () => {
    expect(await threadExtension({ thread: THREAD, viewerDid: MEMBER, boardPublic: true })).toEqual({ panel: null, attach: [] });
    expect(await threadExtension({ thread: THREAD, viewerDid: null, boardPublic: true })).toEqual({ panel: null, attach: [] });
    noNetwork();
    expect(state.hasHandler).not.toHaveBeenCalled();
  });

  it('offers staff an attach link per active install with an attach handler, on an unbound thread on a public board', async () => {
    await writeInstalls({ id: INSTALL, name: 'Diplomacy' }, { id: OTHER, name: 'Chess' }, { id: 'CCCCCCCCCCCCCCCCCCCCCC', state: 'disabled' });
    state.hasHandler.mockImplementation(async (id: string) => id === INSTALL);
    expect(await threadExtension({ thread: THREAD, viewerDid: STAFF, boardPublic: true })).toEqual({
      panel: null,
      attach: [{ installId: INSTALL, name: 'Diplomacy', href: `/x/${INSTALL}/attach?thread=${encodeURIComponent(THREAD)}` }],
    });
    noNetwork();
  });

  it('offers no attach links on a members-only board, or when an install can’t be checked', async () => {
    expect(await threadExtension({ thread: THREAD, viewerDid: STAFF, boardPublic: false })).toEqual({ panel: null, attach: [] });
    state.hasHandler.mockRejectedValue(new Error('load failed'));
    expect(await threadExtension({ thread: THREAD, viewerDid: STAFF, boardPublic: true })).toEqual({ panel: null, attach: [] });
  });

  it('shows nothing while extensions are off or this server lacks the lock', async () => {
    await bindThread(INSTALL);
    state.env.ATMOBB_EXTENSIONS = 'off';
    expect(await threadExtension({ thread: THREAD, viewerDid: STAFF, boardPublic: true })).toBeNull();
    delete state.env.ATMOBB_EXTENSIONS;
    state.lockHeld = false;
    expect(await threadExtension({ thread: THREAD, viewerDid: STAFF, boardPublic: true })).toBeNull();
    noNetwork();
  });
});
