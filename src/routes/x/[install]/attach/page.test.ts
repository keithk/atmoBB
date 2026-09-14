import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The staff attach page over the real registry and binding cache on disk. It
// runs the attach endpoint's checks before drawing the extension's form. The
// seams are the appview, staff lookups, the extensions lock, and the host.

const FORUM = 'did:plc:forumaccount';
const STAFF = 'did:plc:staff';
const MEMBER = 'did:plc:member';
const APP = 'https://forum.test';
const INSTALL = 'AAAAAAAAAAAAAAAAAAAAAA';
const THREAD = 'at://did:plc:author/app.atmobb.discussion.thread/3kgame';
const BOARD = `at://${FORUM}/app.atmobb.forum.board/games`;

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  staff: new Set<string>(),
  lockHeld: true,
  getThreadPage: vi.fn(),
  getBoardAccess: vi.fn(),
  hasHandler: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => FORUM,
  THREAD_NSID: 'app.atmobb.discussion.thread',
  getThreadPage: state.getThreadPage,
  getBoardAccess: state.getBoardAccess,
}));
vi.mock('$lib/server/forum-repo', () => ({ listForumRecords: async () => [] }));
vi.mock('$lib/server/admin', () => ({ canModerateForum: async (did: string | null) => !!did && state.staff.has(did) }));
vi.mock('$lib/server/extensions/lock', () => ({ extensionsLockHeld: () => state.lockHeld }));
vi.mock('$lib/server/extensions/host', () => ({ ExtensionCallError: class extends Error {}, hasHandler: state.hasHandler, dispatchAttach: vi.fn() }));

import { load } from './+page.server';

let directory: string;

async function writeInstall(options: { ui?: boolean; state?: string } = {}) {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const install = {
    id: INSTALL,
    sha: 'abc',
    normalizedUrl: 'https://git.example/jack/diplomacy',
    state: options.state ?? 'active',
    manifest: { name: 'Diplomacy', collections: [], ...(options.ui === false ? {} : { ui: { entry: 'ui/index.html' } }) },
  };
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify({ installs: [install] }));
}

const visit = (did: string | null = STAFF, thread: string | null = THREAD) =>
  load({
    params: { install: INSTALL },
    url: new URL(`${APP}/x/${INSTALL}/attach${thread === null ? '' : `?thread=${encodeURIComponent(thread)}`}`),
    locals: { user: did ? { did, handle: 'someone.test' } : null },
  } as never) as Promise<Record<string, unknown>>;

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: '' }),
    (error: { status?: number; body?: { message?: string } }) => ({ status: error.status, message: error.body?.message ?? '' }),
  );

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-attach-page-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.staff = new Set([STAFF]);
  state.lockHeld = true;
  vi.clearAllMocks();
  state.getThreadPage.mockImplementation(async (uri: string) => ({ thread: { uri, hidden: false, value: { board: BOARD } }, replies: [] }));
  state.getBoardAccess.mockResolvedValue(null);
  state.hasHandler.mockResolvedValue(true);
  await writeInstall();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

describe('/x/[install]/attach page', () => {
  it('draws the extension’s attach form for staff, for a thread on a public board', async () => {
    expect(await visit()).toEqual({
      panel: { installId: INSTALL, name: 'Diplomacy', entry: 'index.html' },
      thread: THREAD,
      threadHref: '/t/did:plc:author/3kgame',
      metadata: { title: 'Attach Diplomacy', noindex: true },
    });
  });

  it('refuses signed-out visitors and members who are not staff', async () => {
    expect(await refusal(visit(null))).toMatchObject({ status: 401 });
    expect(await refusal(visit(MEMBER))).toMatchObject({ status: 403, message: expect.stringContaining('staff') });
    expect(state.getThreadPage).not.toHaveBeenCalled();
  });

  it('refuses a thread on a members-only board, explaining why', async () => {
    state.getBoardAccess.mockResolvedValue(`at://${FORUM}/space/app.atmobb.forum.privateBoard/games`);
    expect(await refusal(visit())).toMatchObject({ status: 403, message: expect.stringContaining('members-only') });
  });

  it('refuses a missing thread, an extension without an attach handler or a UI, and while extensions are off', async () => {
    expect(await refusal(visit(STAFF, null))).toMatchObject({ status: 400 });
    state.hasHandler.mockResolvedValueOnce(false);
    expect(await refusal(visit())).toMatchObject({ status: 422 });
    await writeInstall({ ui: false });
    expect(await refusal(visit())).toMatchObject({ status: 422 });
    state.lockHeld = false;
    expect(await refusal(visit())).toMatchObject({ status: 503 });
  });
});
