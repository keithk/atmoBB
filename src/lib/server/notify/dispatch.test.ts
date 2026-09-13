import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyForPost, resetDispatchForTests, type DispatchDeps, type NotifyForPostInput } from './dispatch';
import { appendEntry, bumpStats, readMember, readStats, resetStoreForTests, setStatus, updateEntry } from './store';
import type { SendResult } from './relay';

const forum = 'did:plc:forum';
const alice = 'did:plc:alice';
const bob = 'did:plc:bob';
const carol = 'did:plc:carol';
const dave = 'did:plc:dave';

const NS = 'app.atmobb';
const thread = `at://${alice}/${NS}.discussion.thread/t1`;
const board = `at://${forum}/${NS}.forum.board/general`;
const space = `at://${forum}/space/${NS}.forum.privateBoard/secret`;
const spaceThread = `${space}/${alice}/${NS}.discussion.thread/t1`;

const mention = (did: string) => ({
  $type: `${NS}.richtext.block#text`,
  text: '@x',
  facets: [{ index: { byteStart: 0, byteEnd: 2 }, features: [{ $type: `${NS}.richtext.facet#mention`, did }] }],
});

let dataDir: string;
const originalDataDir = process.env.DATA_DIR;
let clock: number;

const result = (r: Partial<SendResult>): SendResult => ({ ok: false, status: 0, ...r });

function fakeDeps(overrides: Partial<DispatchDeps> = {}): Partial<DispatchDeps> {
  return {
    senderDid: () => 'did:web:forum.test',
    appUrl: () => 'https://forum.test',
    forumDid: () => forum,
    getWatchers: vi.fn(async () => []),
    boardMembers: vi.fn(async () => []),
    send: vi.fn(async () => result({ ok: true, status: 200, delivered: 1 })),
    now: () => clock,
    ...overrides,
  };
}

// Bob replies in Alice's public thread, mentioning Carol.
const publicReply: NotifyForPostInput = {
  record: { thread: { uri: thread, cid: 'bafy' }, body: [mention(carol)] },
  uri: `at://${bob}/${NS}.discussion.reply/r1`,
  threadUri: thread,
  threadTitle: 'Hello',
  boardUri: board,
  boardName: 'General',
  authorDid: bob,
  authorHandle: 'bob.test',
};

// Bob starts a public thread mentioning Carol.
const publicThread: NotifyForPostInput = {
  record: { body: [mention(carol)] },
  uri: `at://${bob}/${NS}.discussion.thread/t2`,
  threadUri: `at://${bob}/${NS}.discussion.thread/t2`,
  threadTitle: 'Fresh',
  boardUri: board,
  boardName: 'General',
  authorDid: bob,
  authorHandle: 'bob.test',
};

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'atmobb-dispatch-'));
  process.env.DATA_DIR = dataDir;
  resetStoreForTests();
  resetDispatchForTests();
  clock = Date.parse('2026-09-12T12:00:00Z');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const did of [alice, carol, dave]) await setStatus(did, 'on');
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  vi.restoreAllMocks();
});

const entriesOf = async (did: string) => (await readMember(did))?.entries ?? [];

describe('relay outcomes', () => {
  it('marks entries sent on 2xx and counts them', async () => {
    const deps = fakeDeps();
    await notifyForPost(publicReply, deps);
    expect((await entriesOf(alice))[0]).toMatchObject({ kind: 'thread-reply', delivery: 'sent', read: false });
    expect((await entriesOf(carol))[0]).toMatchObject({ kind: 'mention', delivery: 'sent' });
    expect(deps.send).toHaveBeenCalledTimes(2);
    expect((await readStats()).sent).toBe(2);
  });

  it('sends the public body with the marked permalink and the author as actor', async () => {
    const deps = fakeDeps();
    await notifyForPost(publicReply, deps);
    const sent = vi.mocked(deps.send!).mock.calls.map((c) => c[0]);
    const toAlice = sent.find((s) => s.recipient === alice)!;
    expect(toAlice.title).toBe('bob.test replied in "Hello"');
    expect(toAlice.uri).toBe(`https://forum.test/t/${alice}/t1/p/${bob}/r1?via=notify`);
    expect(toAlice.threadKey).toBe(thread);
    expect(toAlice.actors).toEqual([{ did: bob, handle: 'bob.test' }]);
  });

  it('marks entries undelivered on 429 and leaves status alone', async () => {
    const deps = fakeDeps({ send: vi.fn(async () => result({ status: 429 })) });
    await expect(notifyForPost(publicReply, deps)).resolves.toBeUndefined();
    expect((await entriesOf(alice))[0].delivery).toBe('undelivered');
    expect((await entriesOf(carol))[0].delivery).toBe('undelivered');
    expect((await readMember(alice))?.status).toBe('on');
  });

  it('turns a member off on 403 NotAuthorized', async () => {
    const deps = fakeDeps({ send: vi.fn(async () => result({ status: 403, error: 'NotAuthorized' })) });
    await notifyForPost(publicReply, deps);
    expect((await entriesOf(alice))[0].delivery).toBe('undelivered');
    expect((await readMember(alice))?.status).toBe('off');
  });

  it('leaves status on for any other 403', async () => {
    const deps = fakeDeps({
      send: vi
        .fn<DispatchDeps['send']>()
        .mockResolvedValueOnce(result({ status: 403, error: 'RateLimited' }))
        .mockResolvedValueOnce(result({ status: 403 })),
    });
    await notifyForPost(publicReply, deps);
    expect((await entriesOf(alice))[0].delivery).toBe('undelivered');
    expect((await entriesOf(carol))[0].delivery).toBe('undelivered');
    expect((await readMember(alice))?.status).toBe('on');
    expect((await readMember(carol))?.status).toBe('on');
  });
});

describe('recipient filtering', () => {
  it('skips members who are not on', async () => {
    await setStatus(carol, 'pending');
    const deps = fakeDeps();
    await notifyForPost(publicReply, deps);
    expect(await entriesOf(carol)).toEqual([]);
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it('notifies watchers of a new public thread', async () => {
    const deps = fakeDeps({ getWatchers: vi.fn(async () => [dave, bob]) });
    await notifyForPost(publicThread, deps);
    expect(deps.getWatchers).toHaveBeenCalledWith(forum, board);
    expect((await entriesOf(dave))[0]).toMatchObject({ kind: 'board-watch', delivery: 'sent' });
    expect(await entriesOf(bob)).toEqual([]);
  });

  it('does not query watchers for a reply', async () => {
    const deps = fakeDeps();
    await notifyForPost(publicReply, deps);
    expect(deps.getWatchers).not.toHaveBeenCalled();
  });

  it('drops only the member whose state file cannot be read', async () => {
    const deps = fakeDeps({
      store: {
        readMember: vi.fn(async (did: string) => {
          if (did === carol) throw new Error('corrupt state file');
          return readMember(did);
        }),
        appendEntry,
        updateEntry,
        setStatus,
        bumpStats,
      },
    });
    await expect(notifyForPost(publicReply, deps)).resolves.toBeUndefined();
    expect((await entriesOf(alice))[0]).toMatchObject({ kind: 'thread-reply', delivery: 'sent' });
    expect(await entriesOf(carol)).toEqual([]);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.send!).mock.calls[0][0].recipient).toBe(alice);
    expect(console.error).toHaveBeenCalled();
  });

  it('keeps the other kinds when the watcher query throws on a public board', async () => {
    const deps = fakeDeps({
      getWatchers: vi.fn(async () => {
        throw new Error('appview down');
      }),
    });
    await expect(notifyForPost(publicThread, deps)).resolves.toBeUndefined();
    expect((await entriesOf(carol))[0]).toMatchObject({ kind: 'mention', delivery: 'sent' });
    expect(console.error).toHaveBeenCalled();
  });
});

describe('members-only boards', () => {
  const membersOnlyThread: NotifyForPostInput = {
    record: { body: [mention(carol)] },
    uri: `${space}/${bob}/${NS}.discussion.thread/t3`,
    threadUri: `${space}/${bob}/${NS}.discussion.thread/t3`,
    threadTitle: 'Secret plans',
    boardUri: `at://${forum}/${NS}.forum.board/secret`,
    boardName: 'Secret',
    authorDid: bob,
    authorHandle: 'bob.test',
  };

  it('writes nothing and never calls the relay when the membership lookup throws', async () => {
    const deps = fakeDeps({
      getWatchers: vi.fn(async () => [dave]),
      boardMembers: vi.fn(async () => {
        throw new Error('appview down');
      }),
    });
    await expect(notifyForPost(membersOnlyThread, deps)).resolves.toBeUndefined();
    expect(await entriesOf(carol)).toEqual([]);
    expect(await entriesOf(dave)).toEqual([]);
    expect(deps.send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('drops a mentioned outsider and a removed watcher', async () => {
    const deps = fakeDeps({
      getWatchers: vi.fn(async () => [dave, alice]),
      boardMembers: vi.fn(async () => [{ did: alice }, { did: bob }]),
    });
    await notifyForPost(membersOnlyThread, deps);
    expect(deps.boardMembers).toHaveBeenCalledWith(space);
    expect(await entriesOf(carol)).toEqual([]);
    expect(await entriesOf(dave)).toEqual([]);
    expect((await entriesOf(alice))[0]).toMatchObject({ kind: 'board-watch', delivery: 'sent' });
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it('sends a bare alert through the open route and keeps the real link locally', async () => {
    const deps = fakeDeps({ boardMembers: vi.fn(async () => [{ did: alice }, { did: bob }]) });
    await notifyForPost(
      {
        record: { thread: { uri: spaceThread, cid: 'bafy' }, body: [mention(alice)] },
        uri: `${space}/${bob}/${NS}.discussion.reply/r9`,
        threadUri: spaceThread,
        threadTitle: 'Secret plans',
        authorDid: bob,
        authorHandle: 'bob.test',
      },
      deps,
    );
    const [entry] = await entriesOf(alice);
    // `recipient` is the relay's own addressing field; the alert itself must carry no DID.
    const { recipient, ...sent } = vi.mocked(deps.send!).mock.calls[0][0];
    expect(recipient).toBe(alice);
    expect(sent.uri).toBe(`https://forum.test/notifications/open/${entry.id}?via=notify`);
    expect(JSON.stringify(sent)).not.toContain('did:');
    expect(JSON.stringify(sent)).not.toContain('Secret plans');
    expect(sent.actors).toBeUndefined();
    expect(sent.threadKey).toBeUndefined();
    expect(entry.url).toBe(`https://forum.test/b/${forum}/secret/t/${alice}/t1?via=notify#post-r9`);
    expect(entry.title).toContain('Secret plans');
  });
});

describe('cool-down and sender identity', () => {
  it('skips a second alert from the same author to the same member within five minutes', async () => {
    const deps = fakeDeps();
    await notifyForPost(publicReply, deps);
    clock += 60_000;
    await notifyForPost({ ...publicReply, uri: `at://${bob}/${NS}.discussion.reply/r2` }, deps);
    const entries = await entriesOf(alice);
    expect(entries.map((e) => e.delivery)).toEqual(['skipped', 'sent']);
    expect(vi.mocked(deps.send!).mock.calls.filter((c) => c[0].recipient === alice)).toHaveLength(1);
    clock += 5 * 60_000;
    await notifyForPost({ ...publicReply, uri: `at://${bob}/${NS}.discussion.reply/r3` }, deps);
    expect((await entriesOf(alice))[0].delivery).toBe('sent');
  });

  it('does not start the cool-down when the relay refuses the alert', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.send!).mockResolvedValueOnce({ ok: false, status: 502, error: 'Bad gateway' });
    await notifyForPost(publicReply, deps);
    clock += 60_000;
    await notifyForPost({ ...publicReply, uri: `at://${bob}/${NS}.discussion.reply/r2` }, deps);
    expect((await entriesOf(alice)).map((e) => e.delivery)).toEqual(['sent', 'undelivered']);
  });

  it('records skipped entries and never sends without a sender identity', async () => {
    const deps = fakeDeps({ senderDid: () => null });
    await notifyForPost(publicReply, deps);
    expect((await entriesOf(alice))[0]).toMatchObject({ kind: 'thread-reply', delivery: 'skipped' });
    expect(deps.send).not.toHaveBeenCalled();
    expect((await readStats()).sent).toBe(2);
  });
});
