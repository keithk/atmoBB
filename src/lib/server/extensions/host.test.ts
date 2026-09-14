import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionManifest } from '$lib/extensions/contract';

// The host runs real extension code (fixtures/host-probe.wasm, built from
// host-probe.js; see fixtures/README.md) against the real k/v store, scheduler,
// and record layer. The seams are the forum repo's network edge, the relay,
// and the membership, staff, ban, and opt-in lookups.

const FORUM = 'did:plc:forumaccount';
const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';
const CAROL = 'did:plc:carol';
const GAME = 'com.example.diplomacy.game';
const SENTINEL = 'SENTINEL-7d1c4e';
const THREAD = `at://${ALICE}/app.atmobb.discussion.thread/3kthread`;

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  lockHeld: true,
  installs: new Map<string, unknown>(),
  standing: {} as Record<string, string>,
  optedIn: new Set<string>(),
  staff: new Set<string>(),
  banned: new Set<string>(),
  forumWrites: [] as unknown[][],
  writeDelayMs: 0,
  send: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('./lock', () => ({ extensionsLockHeld: () => state.lockHeld }));
vi.mock('./registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./registry')>()),
  getInstall: async (id: string) => state.installs.get(id) ?? null,
}));
vi.mock('../appview', () => ({
  FORUM_DID: () => FORUM,
  getBoardIndex: async () => ({ forum: { membership: { mode: 'apply' } } }),
}));
vi.mock('../forum-repo', () => ({
  FORUM_RECONNECT_MESSAGE: 'Reconnect the forum account',
  isForumScopeError: () => false,
  createForumRecordAsGiven: async (...args: unknown[]) => {
    if (state.writeDelayMs) await new Promise((resolve) => setTimeout(resolve, state.writeDelayMs));
    state.forumWrites.push(args);
    return { uri: `at://${FORUM}/${args[0]}/tid${state.forumWrites.length}`, cid: `bafy${state.forumWrites.length}` };
  },
  putForumRecord: async () => ({ uri: '', cid: '' }),
  deleteForumRecord: async () => {},
  listForumRecords: async () => [],
  getForumRecord: async () => null,
}));
vi.mock('../membership', () => ({
  forumStanding: vi.fn(async (did: string) => ({ mode: 'apply', standing: state.standing[did] ?? 'nonmember', declared: true })),
}));
vi.mock('../admin', () => ({ canModerateForum: async (did: string) => state.staff.has(did) }));
vi.mock('../standing', () => ({
  bannedFrom: async (did: string) => (state.banned.has(did) ? { subject: did } : undefined),
}));
vi.mock('../notify/relay', () => ({ send: (...args: unknown[]) => state.send(...args) }));
vi.mock('../notify/sender', () => ({ senderDid: () => 'did:web:forum.test' }));
vi.mock('../notify/store', () => ({
  readMember: async (did: string) => ({ status: state.optedIn.has(did) ? 'on' : 'off' }),
  setStatus: (...args: unknown[]) => state.setStatus(...args),
}));
vi.mock('../profiles', () => ({ getPublicProfile: async () => ({ notifications: true }) }));

import { forumStanding } from '../membership';
import { kvGet, kvSet } from './kv';
import {
  ExtensionCallError,
  closeExtensionHost,
  dispatchAction,
  dispatchAttach,
  dispatchTimer,
  hasHandler,
  extensionLog,
  migrate,
  openWork,
  resetHostLimitsForTests,
} from './host';

const probe = new URL('./fixtures/host-probe.wasm', import.meta.url).pathname;
// An exports-only module, (module (memory (export "memory") 1) (func (export "action") (result i32) (i32.const 0))),
// for handlers that aren't there.
const bare = Buffer.from('0061736d010000000105016000017f030201000503010001071302066d656d6f7279020006616374696f6e00000a0601040041000b', 'hex');

const lexicon = {
  lexicon: 1,
  id: GAME,
  defs: { main: { type: 'record', key: 'tid', record: { type: 'object', required: ['turn'], properties: { turn: { type: 'integer' } } } } },
};

const manifest = (overrides: Partial<ExtensionManifest> = {}): ExtensionManifest => ({
  id: 'diplomacy',
  name: 'Diplomacy',
  version: '0.1.0',
  hostApi: '1.0',
  dataVersion: 1,
  collections: [GAME],
  capabilities: ['kv', 'records', 'timers', 'notify'],
  lexicons: ['lexicons/game.json'],
  ...overrides,
});

let directory: string;

async function addInstall(id: string, options: { manifest?: ExtensionManifest; state?: string; wasm?: 'probe' | 'bare' } = {}) {
  const sha = `sha-${id}`;
  const dir = join(directory, 'extensions', id, sha);
  await mkdir(join(dir, 'lexicons'), { recursive: true });
  await writeFile(join(dir, 'lexicons', 'game.json'), JSON.stringify(lexicon));
  if (options.wasm === 'bare') await writeFile(join(dir, 'extension.wasm'), bare);
  else await copyFile(probe, join(dir, 'extension.wasm'));
  const install = { id, sha, state: options.state ?? 'active', manifest: options.manifest ?? manifest() };
  state.installs.set(id, install);
  return { install, dir };
}

const hostCall = (installId: string, fn: string, payload: unknown, times = 1) =>
  dispatchAction(installId, ALICE, null, 'host', { fn, payload, times }) as Promise<{ ok: boolean; value?: unknown; error?: { code: string } }[]>;

const callError = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(ExtensionCallError);
      return error as ExtensionCallError;
    },
  );

// Each test gets fresh install ids so stores and rate windows never carry over.
let installCount = 0;
const nextId = () => `install${++installCount}`;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-host-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.env.ATMOBB_APP_URL = 'https://forum.test';
  state.lockHeld = true;
  state.standing = { [ALICE]: 'member', [CAROL]: 'member' };
  state.optedIn = new Set([ALICE, BOB]);
  state.staff = new Set();
  state.banned = new Set();
  state.forumWrites = [];
  state.writeDelayMs = 0;
  state.send.mockReset();
  state.send.mockResolvedValue({ ok: true, status: 200 });
  state.setStatus.mockReset();
  vi.mocked(forumStanding).mockClear();
  resetHostLimitsForTests();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await closeExtensionHost();
});

describe('dispatchAction', () => {
  it('sets a key, publishes a record as the forum, and schedules a timer through the host, and the timer fires the guest', async () => {
    const id = nextId();
    await addInstall(id);
    const at = new Date(Date.now() + 120_000).toISOString();
    const result = await dispatchAction(id, ALICE, null, 'effects', { value: { turn: 1 }, collection: GAME, record: { turn: 1 }, at });

    expect(result).toEqual({
      kv: { ok: true, value: null },
      record: { ok: true, value: { uri: `at://${FORUM}/${GAME}/tid1`, cid: 'bafy1' } },
      timer: { ok: true, value: null },
    });
    expect(await kvGet(id, { key: 'last' })).toEqual({ value: { turn: 1 } });
    expect(state.forumWrites).toEqual([[GAME, { turn: 1, $type: GAME }, undefined]]);
    const timers = JSON.parse(await readFile(join(directory, 'extensions', 'timers.json'), 'utf8')).timers;
    expect(timers).toEqual([expect.objectContaining({ installId: id, name: 'deadline', at, payload: { turn: 1 } })]);

    await dispatchTimer(id, { name: 'deadline', at, payload: { turn: 1 } });
    expect(await kvGet(id, { key: 'timer:deadline' })).toEqual({ value: { turn: 1 } });
  });

  it('tells the handler the session viewer, ignoring a viewer inside the payload', async () => {
    const id = nextId();
    await addInstall(id);
    state.staff.add(ALICE);
    const forged = { viewer: { did: 'did:plc:mallory', standing: 'member', staff: true, banned: false } };
    expect(await dispatchAction(id, ALICE, null, 'viewer', forged)).toEqual({
      viewer: { did: ALICE, standing: 'member', staff: true, banned: false },
      thread: null,
      input: forged,
    });
    expect(forumStanding).toHaveBeenCalledWith(ALICE, expect.anything(), expect.anything());
  });

  it('gives an anonymous viewer no DID and non-member standing', async () => {
    const id = nextId();
    await addInstall(id);
    expect(await dispatchAction(id, null, null, 'viewer', {})).toEqual({
      viewer: { did: null, standing: 'nonmember', staff: false, banned: false },
      thread: null,
      input: {},
    });
    expect(forumStanding).not.toHaveBeenCalled();
  });

  it('tells the handler which thread the action is for', async () => {
    const id = nextId();
    await addInstall(id);
    expect(await dispatchAction(id, ALICE, { uri: THREAD }, 'viewer', {})).toMatchObject({ thread: { uri: THREAD } });
  });

  it('fails a call that makes more host calls than the cap', async () => {
    state.env.ATMOBB_EXTENSIONS_CALL_HOST_CALLS = '5';
    const id = nextId();
    await addInstall(id);
    expect(await hostCall(id, 'kv_get', { key: 'x' }, 5)).toHaveLength(5);
    expect((await callError(hostCall(id, 'kv_get', { key: 'x' }, 6))).code).toBe('call_limit');
  });

  it('fails a call whose host-call arguments or output are bigger than the caps', async () => {
    state.env.ATMOBB_EXTENSIONS_CALL_ARG_BYTES = '1000';
    state.env.ATMOBB_EXTENSIONS_CALL_RETURN_BYTES = '1000';
    const id = nextId();
    await addInstall(id);

    expect((await callError(hostCall(id, 'kv_set', { key: 'big', value: 'x'.repeat(1000) }))).code).toBe('call_limit');
    expect(await kvGet(id, { key: 'big' })).toEqual({ value: null });

    expect(await dispatchAction(id, ALICE, null, 'big', 998)).toBe('x'.repeat(998));
    expect((await callError(dispatchAction(id, ALICE, null, 'big', 999))).code).toBe('call_limit');

    await kvSet(id, { key: 'wide', value: 'x'.repeat(1000) });
    expect((await callError(hostCall(id, 'kv_get', { key: 'wide' }))).code).toBe('call_limit');
  });

  it('fails a call that spends more than the host I/O budget waiting on the host', async () => {
    state.env.ATMOBB_EXTENSIONS_HOST_IO_MS = '200';
    state.writeDelayMs = 600;
    const id = nextId();
    await addInstall(id);
    const began = performance.now();
    expect((await callError(hostCall(id, 'record_create', { collection: GAME, record: { turn: 1 } }))).code).toBe('call_limit');
    expect(performance.now() - began).toBeLessThan(600);
  });

  it('refuses record writes past the hourly cap', async () => {
    state.env.ATMOBB_EXTENSIONS_RECORD_WRITES_PER_HOUR = '2';
    const id = nextId();
    await addInstall(id);
    const replies = await hostCall(id, 'record_create', { collection: GAME, record: { turn: 1 } }, 3);
    expect(replies.map((reply) => reply.ok)).toEqual([true, true, false]);
    expect(replies[2].error?.code).toBe('rate_limited');
    expect(state.forumWrites).toHaveLength(2);
  });

  it('refuses a capability the manifest was not granted, without doing anything', async () => {
    const id = nextId();
    await addInstall(id, { manifest: manifest({ capabilities: ['kv'] }) });
    const [record] = await hostCall(id, 'record_create', { collection: GAME, record: { turn: 1 } });
    const [notify] = await hostCall(id, 'notify', { to: [ALICE], title: 'Hi', message: 'Hello' });
    const [timer] = await hostCall(id, 'timer_set', { name: 't', at: new Date(Date.now() + 120_000).toISOString() });
    for (const reply of [record, notify, timer]) expect(reply).toMatchObject({ ok: false, error: { code: 'capability_not_granted' } });
    expect(state.forumWrites).toEqual([]);
    expect(state.send).not.toHaveBeenCalled();
    expect(await hostCall(id, 'kv_set', { key: 'k', value: 1 })).toEqual([{ ok: true, value: null }]);
  });

  it('refuses calls for a disabled install, and every call while extensions are off or the lock is not held', async () => {
    const disabled = nextId();
    await addInstall(disabled, { state: 'disabled' });
    expect((await callError(dispatchAction(disabled, ALICE, null, 'viewer', {}))).code).toBe('disabled');
    expect((await callError(dispatchTimer(disabled, { name: 'x', at: new Date().toISOString() }))).code).toBe('disabled');
    expect((await callError(dispatchAction(nextId(), ALICE, null, 'viewer', {}))).code).toBe('not_installed');

    const id = nextId();
    await addInstall(id);
    state.env.ATMOBB_EXTENSIONS = 'off';
    expect((await callError(dispatchAction(id, ALICE, null, 'viewer', {}))).code).toBe('unavailable');
    expect((await callError(openWork(id))).code).toBe('unavailable');
    delete state.env.ATMOBB_EXTENSIONS;
    state.lockHeld = false;
    expect((await callError(dispatchAction(id, ALICE, null, 'viewer', {}))).code).toBe('unavailable');
    expect((await callError(dispatchTimer(id, { name: 'x', at: new Date().toISOString() }))).code).toBe('unavailable');
  });

  it('rate-limits actions per viewer', async () => {
    state.env.ATMOBB_EXTENSIONS_ACTIONS_PER_VIEWER_PER_MINUTE = '2';
    const id = nextId();
    await addInstall(id);
    await dispatchAction(id, ALICE, null, 'viewer', {});
    await dispatchAction(id, ALICE, null, 'viewer', {});
    expect((await callError(dispatchAction(id, ALICE, null, 'viewer', {}))).code).toBe('rate_limited');
    expect(await dispatchAction(id, BOB, null, 'viewer', {})).toMatchObject({ viewer: { did: BOB } });
  });

  it('keeps payloads out of server output, sending guest console output and errors to the install log', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const id = nextId();
    await addInstall(id);
    const written: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void written.push(args.map(String).join(' ')));
    }
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    }

    const error = await callError(dispatchAction(id, ALICE, null, 'leak', SENTINEL));
    expect(error.code).toBe('failed');
    expect(error.message).not.toContain(SENTINEL);
    // Let any late worker output arrive before checking.
    await new Promise((resolve) => setTimeout(resolve, 50));
    vi.restoreAllMocks();

    expect(written.join('\n')).not.toContain(SENTINEL);
    expect(written.join('\n')).toContain(id);
    const log = extensionLog(id);
    expect(log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'info', text: SENTINEL }),
        expect.objectContaining({ level: 'error', text: expect.stringContaining(SENTINEL) }),
      ]),
    );
  });
});

describe('notify', () => {
  const notify = (id: string, payload: Record<string, unknown>) => hostCall(id, 'notify', payload).then(([reply]) => reply);

  it('sends only to opted-in members, prefixing the title with the extension name and linking on the forum', async () => {
    const id = nextId();
    await addInstall(id);
    const reply = await notify(id, { to: [ALICE, BOB, CAROL], title: 'Orders due', message: 'Turn 3 closes soon', link: '/games/1' });
    expect(reply).toEqual({ ok: true, value: { sent: 1 } });
    expect(state.send).toHaveBeenCalledExactlyOnceWith({
      recipient: ALICE,
      title: 'Diplomacy: Orders due',
      body: 'Turn 3 closes soon',
      uri: 'https://forum.test/games/1',
    });
  });

  it('refuses a link off the forum origin', async () => {
    const id = nextId();
    await addInstall(id);
    for (const link of ['https://evil.test/games/1', '//evil.test/games/1', 'javascript:alert(1)']) {
      expect(await notify(id, { to: [ALICE], title: 'Orders due', message: 'Now', link })).toMatchObject({
        ok: false,
        error: { code: 'invalid_link' },
      });
    }
    expect(state.send).not.toHaveBeenCalled();
    expect(await notify(id, { to: [ALICE], title: 'Orders due', message: 'Now', link: 'https://forum.test/games/1' })).toMatchObject({
      ok: true,
    });
  });

  it('caps notifications per recipient and per install per day', async () => {
    state.env.ATMOBB_EXTENSIONS_NOTIFY_PER_RECIPIENT_PER_DAY = '1';
    state.env.ATMOBB_EXTENSIONS_NOTIFY_PER_INSTALL_PER_DAY = '2';
    state.standing[BOB] = 'member';
    state.optedIn.add(CAROL);
    const id = nextId();
    await addInstall(id);
    expect(await notify(id, { to: [ALICE], title: 'One', message: 'm' })).toEqual({ ok: true, value: { sent: 1 } });
    expect(await notify(id, { to: [ALICE, BOB], title: 'Two', message: 'm' })).toEqual({ ok: true, value: { sent: 1 } });
    expect(await notify(id, { to: [CAROL], title: 'Three', message: 'm' })).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(state.send).toHaveBeenCalledTimes(2);
  });
});

describe('optional handlers', () => {
  it('runs attach with the viewer, the thread, and the setup input, and reports whether the module exports it', async () => {
    const id = nextId();
    await addInstall(id);
    state.staff.add(ALICE);
    expect(await hasHandler(id, 'attach')).toBe(true);
    expect(await dispatchAttach(id, ALICE, { uri: THREAD }, { players: 7 })).toEqual({
      viewer: { did: ALICE, standing: 'member', staff: true, banned: false },
      thread: { uri: THREAD },
      input: { players: 7 },
    });
    expect(await kvGet(id, { key: `attached:${THREAD}` })).toEqual({ value: { players: 7 } });
    expect((await callError(dispatchAttach(id, ALICE, { uri: THREAD }, { fail: true }))).code).toBe('failed');
  });

  it('refuses attach for a module without the export', async () => {
    const id = nextId();
    await addInstall(id, { wasm: 'bare' });
    expect(await hasHandler(id, 'attach')).toBe(false);
    expect((await callError(dispatchAttach(id, ALICE, { uri: THREAD }, {}))).code).toBe('no_handler');
  });

  it('no-ops a timer and reports no open work when the module lacks those exports', async () => {
    const id = nextId();
    await addInstall(id, { wasm: 'bare' });
    await expect(dispatchTimer(id, { name: 'x', at: new Date().toISOString() })).resolves.toBeUndefined();
    expect(await openWork(id)).toBe(false);
  });

  it('asks the guest for open work when it exports openWork', async () => {
    const id = nextId();
    await addInstall(id);
    expect(await openWork(id)).toBe(false);
    await kvSet(id, { key: 'open', value: true });
    expect(await openWork(id)).toBe(true);
  });

  it('runs the new release’s migrate when the data version rises, and nothing otherwise', async () => {
    const id = nextId();
    const { install, dir } = await addInstall(id);
    const from = { tag: 'v0.1.0', sha: install.sha, manifest: install.manifest, dir };
    const to = { tag: 'v0.2.0', sha: 'sha-next', manifest: manifest({ dataVersion: 2 }), dir };
    const context = { install: install as never, from, to };

    await migrate({ ...context, to: { ...to, manifest: manifest({ dataVersion: 1 }) } });
    expect(await kvGet(id, { key: 'migrated' })).toEqual({ value: null });

    await migrate(context);
    expect(await kvGet(id, { key: 'migrated' })).toEqual({ value: { from: 1, to: 2 } });
  });
});
