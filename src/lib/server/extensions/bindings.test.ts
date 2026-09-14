import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The binding cache against a registry on disk and an in-memory forum repo.
// The seams are the forum repo and the appview.

const FORUM = 'did:plc:forumaccount';
const BINDING = 'app.atmobb.extension.binding';
const DIPLOMACY_URL = 'https://git.example/jack/diplomacy';
const CHESS_URL = 'https://git.example/jack/chess';
const GONE_URL = 'https://git.example/jack/gone';
const threadAt = (rkey: string) => `at://did:plc:author/app.atmobb.discussion.thread/${rkey}`;
const BOARD = `at://${FORUM}/app.atmobb.forum.board/games`;

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  repo: new Map<string, { uri: string; cid: string; value: Record<string, unknown> }[]>(),
  listForumRecords: vi.fn(),
  getForumRecord: vi.fn(),
  getThreadPage: vi.fn(),
  getBoardAccess: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('../appview', () => ({
  FORUM_DID: () => FORUM,
  THREAD_NSID: 'app.atmobb.discussion.thread',
  getThreadPage: state.getThreadPage,
  getBoardAccess: state.getBoardAccess,
}));
vi.mock('../forum-repo', () => ({
  listForumRecords: state.listForumRecords,
  getForumRecord: state.getForumRecord,
}));
import { bindingAccess, bindingFor, bindingRkey, rebuildBindings } from './bindings';

let directory: string;

async function writeInstalls(installs: { id: string; normalizedUrl: string; state?: 'active' | 'disabled' }[]) {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const store = { installs: installs.map((install) => ({ state: 'active', manifest: { name: install.id, collections: [] }, ...install })) };
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify(store));
}

/** Put a host binding record in the forum repo, at the thread's key unless told otherwise. */
function putBinding(thread: string, extension: string, rkey = bindingRkey(thread)) {
  const records = state.repo.get(BINDING) ?? [];
  records.push({
    uri: `at://${FORUM}/${BINDING}/${rkey}`,
    cid: `bafy${rkey}`,
    value: { $type: BINDING, thread, extension, attachedBy: 'did:plc:staff', createdAt: '2026-09-13T12:00:00.000Z' },
  });
  state.repo.set(BINDING, records);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-bindings-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.repo = new Map();
  vi.clearAllMocks();
  state.listForumRecords.mockImplementation(async (collection: string) => state.repo.get(collection) ?? []);
  state.getForumRecord.mockResolvedValue(null);
  state.getThreadPage.mockImplementation(async (uri: string) => ({ thread: { uri, hidden: false, value: { board: BOARD } }, replies: [], replyCount: 0 }));
  state.getBoardAccess.mockResolvedValue(null);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('binding record keys', () => {
  it('derives one valid record key per thread', () => {
    const key = bindingRkey(threadAt('3kone'));
    expect(key).toMatch(/^[a-z2-7]{1,512}$/);
    expect(bindingRkey(threadAt('3kone'))).toBe(key);
    expect(bindingRkey(threadAt('3ktwo'))).not.toBe(key);
  });
});

describe('rebuildBindings', () => {
  it('restores every host binding from the forum repo after the cache is wiped, mapping git URLs to current installs', async () => {
    await writeInstalls([
      { id: 'install-diplomacy', normalizedUrl: DIPLOMACY_URL },
      { id: 'install-chess', normalizedUrl: CHESS_URL },
    ]);
    putBinding(threadAt('3kone'), DIPLOMACY_URL);
    putBinding(threadAt('3ktwo'), CHESS_URL);
    putBinding(threadAt('3kthree'), GONE_URL);

    await rebuildBindings();
    expect(await bindingFor(threadAt('3kone'))).toMatchObject({ installId: 'install-diplomacy', thread: threadAt('3kone'), attachedBy: 'did:plc:staff' });
    expect(await bindingFor(threadAt('3ktwo'))).toMatchObject({ installId: 'install-chess' });
    expect(await bindingFor(threadAt('3kthree'))).toBeNull();

    await rm(join(directory, 'extensions', 'bindings.json'));
    expect(await bindingFor(threadAt('3kone'))).toBeNull();

    // Reinstalling gives the repository a new install id; the rebuild follows it.
    await writeInstalls([
      { id: 'install-diplomacy-again', normalizedUrl: DIPLOMACY_URL },
      { id: 'install-chess', normalizedUrl: CHESS_URL },
    ]);
    await rebuildBindings();
    expect(await bindingFor(threadAt('3kone'))).toMatchObject({ installId: 'install-diplomacy-again' });
    expect(await bindingFor(threadAt('3ktwo'))).toMatchObject({ installId: 'install-chess' });
  });

  it('never binds a thread from an extension-published record, or from a binding record away from its thread key', async () => {
    await writeInstalls([{ id: 'install-diplomacy', normalizedUrl: DIPLOMACY_URL }]);
    const game = 'com.example.diplomacy.game';
    state.repo.set(game, [
      { uri: `at://${FORUM}/${game}/3kgame`, cid: 'bafygame', value: { $type: BINDING, thread: threadAt('3kone'), extension: DIPLOMACY_URL } },
    ]);
    putBinding(threadAt('3ktwo'), DIPLOMACY_URL, 'somewhereelse');

    await rebuildBindings();
    expect(await bindingFor(threadAt('3kone'))).toBeNull();
    expect(await bindingFor(threadAt('3ktwo'))).toBeNull();
    expect(state.listForumRecords.mock.calls).toEqual([[BINDING]]);
  });

  it('keeps the cache when the forum repo cannot be listed', async () => {
    await writeInstalls([{ id: 'install-diplomacy', normalizedUrl: DIPLOMACY_URL }]);
    putBinding(threadAt('3kone'), DIPLOMACY_URL);
    await rebuildBindings();

    state.listForumRecords.mockRejectedValue(new Error('PDS unreachable'));
    await expect(rebuildBindings()).rejects.toThrow('PDS unreachable');
    expect(await bindingFor(threadAt('3kone'))).toMatchObject({ installId: 'install-diplomacy' });
  });
});

describe('bindingFor', () => {
  it('reads only the local cache, bound or not', async () => {
    await writeInstalls([{ id: 'install-diplomacy', normalizedUrl: DIPLOMACY_URL }]);
    putBinding(threadAt('3kone'), DIPLOMACY_URL);
    await rebuildBindings();
    vi.clearAllMocks();

    expect(await bindingFor(threadAt('3kunbound'))).toBeNull();
    expect(await bindingFor(threadAt('3kone'))).not.toBeNull();
    for (const network of [state.listForumRecords, state.getForumRecord, state.getThreadPage, state.getBoardAccess]) {
      expect(network).not.toHaveBeenCalled();
    }
  });

  it('is null while the bound install is disabled or gone', async () => {
    await writeInstalls([{ id: 'install-diplomacy', normalizedUrl: DIPLOMACY_URL }]);
    putBinding(threadAt('3kone'), DIPLOMACY_URL);
    await rebuildBindings();

    await writeInstalls([{ id: 'install-diplomacy', normalizedUrl: DIPLOMACY_URL, state: 'disabled' }]);
    expect(await bindingFor(threadAt('3kone'))).toBeNull();
    await writeInstalls([]);
    expect(await bindingFor(threadAt('3kone'))).toBeNull();
  });
});

describe('bindingAccess', () => {
  it('passes a visible thread on a public board, and fails once the board turns members-only', async () => {
    expect(await bindingAccess(threadAt('3kone'))).toEqual({ ok: true });
    expect(state.getBoardAccess).toHaveBeenCalledWith(BOARD);

    state.getBoardAccess.mockResolvedValue(`at://${FORUM}/space/app.atmobb.forum.privateBoard/games`);
    expect(await bindingAccess(threadAt('3kone'))).toMatchObject({ ok: false, reason: 'members-only', message: expect.stringContaining('members-only') });
  });

  it('fails for a hidden, removed, or other forum’s thread, a non-thread URI, and when the appview cannot answer', async () => {
    state.getThreadPage.mockResolvedValueOnce({ thread: { hidden: true, value: { board: BOARD } }, replies: [] });
    expect(await bindingAccess(threadAt('3kone'))).toMatchObject({ ok: false, reason: 'hidden' });

    state.getThreadPage.mockResolvedValueOnce({ replies: [] });
    expect(await bindingAccess(threadAt('3kone'))).toMatchObject({ ok: false, reason: 'missing' });

    state.getThreadPage.mockResolvedValueOnce({ thread: { hidden: false, origin: { did: 'did:plc:other' }, value: { board: BOARD } }, replies: [] });
    expect(await bindingAccess(threadAt('3kone'))).toMatchObject({ ok: false, reason: 'elsewhere' });

    expect(await bindingAccess(`at://${FORUM}/app.atmobb.forum.board/games`)).toMatchObject({ ok: false, reason: 'missing' });

    state.getThreadPage.mockRejectedValueOnce(new Error('appview down'));
    expect(await bindingAccess(threadAt('3kone'))).toMatchObject({ ok: false, reason: 'unavailable' });

    state.getBoardAccess.mockRejectedValueOnce(new Error('space lookup failed'));
    expect(await bindingAccess(threadAt('3kone'))).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});
