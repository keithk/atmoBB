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
const ORDER = 'com.example.diplomacy.order';
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
  onForumWrite: null as (() => void) | null,
  runtimeHas: vi.fn(),
  runtimeCall: vi.fn(),
  migrateAs: null as unknown,
  migrateOutput: null as string | null,
  send: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('./lock', () => ({ extensionsLockHeld: () => state.lockHeld }));
// The real runtime, with its export checks and calls counted as they're
// queued. While `migrateAs` is set, a migrate call runs the probe's `action`
// with that input instead, on the migrate call's own module, budget, and turn,
// so a test can have a migration call any host function. The guest's output is
// kept even when the migration then fails.
vi.mock('./runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runtime')>();
  return {
    ...actual,
    extensionRuntime: (...args: Parameters<typeof actual.extensionRuntime>) => {
      const runtime = actual.extensionRuntime(...args);
      const has = runtime.has;
      runtime.has = (installId, name) => {
        state.runtimeHas(installId, name);
        return has(installId, name);
      };
      const call = runtime.call;
      runtime.call = (installId, name, input, options = {}) => {
        state.runtimeCall(installId, name);
        if (name !== 'migrate' || !state.migrateAs) return call(installId, name, input, options);
        const around = options.around ?? ((invoke) => invoke());
        return call(installId, 'action', JSON.stringify(state.migrateAs), {
          ...options,
          around: (invoke) => around(async () => (state.migrateOutput = await invoke())),
        });
      };
      return runtime;
    },
  };
});
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
    state.onForumWrite?.();
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
  ExtensionRefusal,
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

async function addInstall(id: string, options: { manifest?: ExtensionManifest; state?: string; wasm?: 'probe' | 'bare'; sha?: string } = {}) {
  const sha = options.sha ?? `sha-${id}`;
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
  state.onForumWrite = null;
  state.runtimeHas.mockReset();
  state.runtimeCall.mockReset();
  state.migrateAs = null;
  state.migrateOutput = null;
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
    expect(await kvGet(id, { key: 'timer-forum:deadline' })).toEqual({ value: { did: FORUM } });
  });

  it("tells the handler the forum's DID, signed in or out", async () => {
    const id = nextId();
    await addInstall(id);
    expect(await dispatchAction(id, ALICE, { uri: THREAD }, 'forum', {})).toEqual({ forum: { did: FORUM } });
    expect(await dispatchAction(id, null, null, 'forum', {}, { client: '203.0.113.1' })).toEqual({ forum: { did: FORUM } });
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

    // The output limit counts the {"value":...} envelope around the string.
    expect(await dispatchAction(id, ALICE, null, 'big', 988)).toBe('x'.repeat(988));
    expect((await callError(dispatchAction(id, ALICE, null, 'big', 989))).code).toBe('call_limit');

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

  it('refuses a timer whose name or payload is over the caps, without scheduling it', async () => {
    state.env.ATMOBB_EXTENSIONS_TIMER_MAX_NAME_LENGTH = '10';
    state.env.ATMOBB_EXTENSIONS_TIMER_MAX_PAYLOAD_BYTES = '100';
    const id = nextId();
    await addInstall(id);
    const at = new Date(Date.now() + 120_000).toISOString();
    // A string payload serializes with its two quotes.
    expect(await hostCall(id, 'timer_set', { name: 'x'.repeat(10), at, payload: 'x'.repeat(98) })).toEqual([{ ok: true, value: null }]);
    const [longName] = await hostCall(id, 'timer_set', { name: 'x'.repeat(11), at });
    const [bigPayload] = await hostCall(id, 'timer_set', { name: 'big', at, payload: 'x'.repeat(99) });
    for (const reply of [longName, bigPayload]) expect(reply).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    const timers = JSON.parse(await readFile(join(directory, 'extensions', 'timers.json'), 'utf8')).timers;
    expect(timers.map((timer: { name: string }) => timer.name)).toEqual(['x'.repeat(10)]);
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

  it('rate-limits signed-out actions per client address, in windows apart from signed-in viewers', async () => {
    state.env.ATMOBB_EXTENSIONS_ACTIONS_PER_VIEWER_PER_MINUTE = '2';
    state.env.ATMOBB_EXTENSIONS_ANONYMOUS_ACTIONS_PER_INSTALL_PER_MINUTE = '3';
    state.env.ATMOBB_EXTENSIONS_ACTIONS_PER_INSTALL_PER_MINUTE = '3';
    const id = nextId();
    await addInstall(id);

    await dispatchAction(id, null, null, 'viewer', {}, { client: '203.0.113.1' });
    await dispatchAction(id, null, null, 'viewer', {}, { client: '203.0.113.1' });
    expect((await callError(dispatchAction(id, null, null, 'viewer', {}, { client: '203.0.113.1' }))).code).toBe('rate_limited');
    await dispatchAction(id, null, null, 'viewer', {}, { client: '203.0.113.2' });
    // The install's signed-out window is full now, whichever address asks.
    expect((await callError(dispatchAction(id, null, null, 'viewer', {}, { client: '203.0.113.3' }))).code).toBe('rate_limited');

    // None of that touches a member's actions.
    for (let i = 0; i < 2; i++) expect(await dispatchAction(id, ALICE, { uri: THREAD }, 'viewer', {})).toMatchObject({ viewer: { did: ALICE } });
    expect(await dispatchAction(id, BOB, { uri: THREAD }, 'viewer', {})).toMatchObject({ viewer: { did: BOB } });
  });

  it('runs one signed-out action per install at a time, so a flood of them never queues ahead of members', async () => {
    const id = nextId();
    await addInstall(id);
    const first = dispatchAction(id, null, null, 'viewer', {}, { client: '203.0.113.1' });
    expect((await callError(dispatchAction(id, null, null, 'viewer', {}, { client: '203.0.113.2' }))).code).toBe('rate_limited');
    expect(await dispatchAction(id, ALICE, { uri: THREAD }, 'viewer', {})).toMatchObject({ viewer: { did: ALICE } });
    await first;
    expect(await dispatchAction(id, null, null, 'viewer', {}, { client: '203.0.113.2' })).toMatchObject({ viewer: { did: null } });
  });

  it('refuses a signed-out action from a thread', async () => {
    const id = nextId();
    await addInstall(id);
    expect((await callError(dispatchAction(id, null, { uri: THREAD }, 'viewer', {}, { client: '203.0.113.1' }))).code).toBe('sign_in_required');
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

describe('refusals', () => {
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('expected the call to be refused');
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(ExtensionRefusal);
        return error as ExtensionRefusal;
      },
    );

  it("passes an action's refusal on with its code and message, keeping both out of server output", async () => {
    const id = nextId();
    await addInstall(id);
    const written: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void written.push(args.map(String).join(' ')));
    }

    const refused = await refusal(dispatchAction(id, ALICE, null, 'refuse', { code: 'no_army', message: `No army in Paris ${SENTINEL}` }));
    expect({ code: refused.code, message: refused.message }).toEqual({ code: 'no_army', message: `No army in Paris ${SENTINEL}` });
    vi.restoreAllMocks();
    expect(written.join('\n')).not.toContain(SENTINEL);
    expect(written.join('\n')).not.toContain('no_army');
  });

  it('cuts a long refusal message and fails a refusal whose code or message is malformed', async () => {
    const id = nextId();
    await addInstall(id);
    const long = await refusal(dispatchAction(id, ALICE, null, 'refuse', { code: 'too_long', message: 'x'.repeat(1000) }));
    expect(long.message).toHaveLength(300);

    for (const refused of [
      { code: 'Not A Code', message: 'nope' },
      { code: 'x'.repeat(41), message: 'nope' },
      { message: 'no code' },
      { code: 'no_message' },
      { code: 'empty', message: '' },
      'refused',
    ]) {
      expect((await callError(dispatchAction(id, ALICE, null, 'refuse', refused))).code, JSON.stringify(refused)).toBe('bad_output');
    }
  });

  it('fails output that is not a value or a refusal', async () => {
    const id = nextId();
    await addInstall(id);
    expect(await dispatchAction(id, ALICE, null, 'raw', { value: { refused: { code: 'x', message: 'y' } } })).toEqual({ refused: { code: 'x', message: 'y' } });
    for (const raw of [{ moved: true }, { value: 1, extra: true }, [1], 7, null]) {
      expect((await callError(dispatchAction(id, ALICE, null, 'raw', raw))).code, JSON.stringify(raw)).toBe('bad_output');
    }
  });

  it("passes an attach handler's refusal on", async () => {
    const id = nextId();
    await addInstall(id);
    const refused = await refusal(dispatchAttach(id, ALICE, { uri: THREAD }, { refuse: { code: 'players', message: 'Pick 2 to 7 players' } }));
    expect({ code: refused.code, message: refused.message }).toEqual({ code: 'players', message: 'Pick 2 to 7 players' });
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
  it('runs attach with the viewer, the thread, the forum, and the setup input, and reports whether the module exports it', async () => {
    const id = nextId();
    await addInstall(id);
    state.staff.add(ALICE);
    expect(await hasHandler(id, 'attach')).toBe(true);
    expect(await dispatchAttach(id, ALICE, { uri: THREAD }, { players: 7 })).toEqual({
      viewer: { did: ALICE, standing: 'member', staff: true, banned: false },
      thread: { uri: THREAD },
      forum: { did: FORUM },
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

  it('remembers whether a release exports a handler, and asks again once the install moves to another release', async () => {
    const id = nextId();
    await addInstall(id);
    expect(await hasHandler(id, 'attach')).toBe(true);
    expect(await hasHandler(id, 'attach')).toBe(true);
    expect(state.runtimeHas).toHaveBeenCalledTimes(1);

    await addInstall(id, { wasm: 'bare', sha: 'sha-next' });
    expect(await hasHandler(id, 'attach')).toBe(false);
    expect(await hasHandler(id, 'attach')).toBe(false);
    expect(state.runtimeHas).toHaveBeenCalledTimes(2);
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
    const context = { install: install as never, from, to, signal: new AbortController().signal };

    await migrate({ ...context, to: { ...to, manifest: manifest({ dataVersion: 1 }) } });
    expect(await kvGet(id, { key: 'migrated' })).toEqual({ value: null });

    await migrate(context);
    expect(await kvGet(id, { key: 'migrated' })).toEqual({ value: { from: 1, to: 2 } });
  });

  async function migrationContext(toManifest: ExtensionManifest) {
    const id = nextId();
    const { install, dir } = await addInstall(id);
    const from = { tag: 'v0.1.0', sha: install.sha, manifest: install.manifest, dir };
    const to = { tag: 'v0.2.0', sha: 'sha-next', manifest: toManifest, dir };
    return { id, context: { install: install as never, from, to, signal: new AbortController().signal } };
  }

  /** Run a migration that calls `fn` through the host `times` times, and return the host's replies. */
  async function migrateCalling(context: Parameters<typeof migrate>[0], fn: string, payload: unknown, times = 1) {
    state.migrateAs = { action: 'host', input: { fn, payload, times } };
    await migrate(context);
    return (JSON.parse(state.migrateOutput!) as { value: { ok: boolean; value?: unknown; error?: { code: string } }[] }).value;
  }

  it("gives a migration its own host-call budget and doesn't count its k/v writes against the write rate", async () => {
    state.env.ATMOBB_EXTENSIONS_CALL_HOST_CALLS = '5';
    state.env.ATMOBB_KV_MAX_WRITES_PER_MINUTE = '2';
    const { id, context } = await migrationContext(manifest({ dataVersion: 2 }));

    const replies = await migrateCalling(context, 'kv_set', { key: 'converted', value: true }, 10);
    expect(replies).toEqual(Array(10).fill({ ok: true, value: null }));
    expect(await kvGet(id, { key: 'converted' })).toEqual({ value: true });

    // An ordinary call is still held to both.
    const ordinary = await hostCall(id, 'kv_set', { key: 'x', value: 1 }, 3);
    expect(ordinary.map((reply) => reply.ok)).toEqual([true, true, false]);
    expect((await callError(hostCall(id, 'kv_get', { key: 'x' }, 6))).code).toBe('call_limit');
  });

  it('lets a migration write records only in collections both releases declare', async () => {
    const { context } = await migrationContext(manifest({ dataVersion: 2, collections: [GAME, ORDER] }));

    const [added] = await migrateCalling(context, 'record_create', { collection: ORDER, record: { turn: 1 } });
    expect(added).toMatchObject({ ok: false, error: { code: 'CollectionNotApproved' } });
    const [shared] = await migrateCalling(context, 'record_create', { collection: GAME, record: { turn: 1 } });
    expect(shared).toMatchObject({ ok: true });
    expect(state.forumWrites).toEqual([[GAME, { turn: 1, $type: GAME }, undefined]]);
  });

  /** Queue an action that holds the install's queue for half a second while it writes a record. */
  async function holdQueue(id: string) {
    state.writeDelayMs = 500;
    const held = hostCall(id, 'record_create', { collection: GAME, record: { turn: 1 } });
    await vi.waitFor(() => expect(state.runtimeCall).toHaveBeenCalledTimes(1));
    return { held };
  }

  const guestReplies = () => (JSON.parse(state.migrateOutput!) as { value: { ok: boolean; error?: { code: string } }[] }).value;

  it('keeps k/v writes from a call queued ahead of a failed migration, and puts back only the migration’s', async () => {
    state.env.ATMOBB_EXTENSIONS_MIGRATE_HOST_CALLS = '2';
    const { id, context } = await migrationContext(manifest({ dataVersion: 2 }));
    const { held } = await holdQueue(id);
    const orders = hostCall(id, 'kv_set', { key: 'orders', value: ['A Par-Bur'] });
    await vi.waitFor(() => expect(state.runtimeCall).toHaveBeenCalledTimes(2));

    // The third write goes past the migration's host-call limit, after two have landed.
    state.migrateAs = { action: 'host', input: { fn: 'kv_set', payload: { key: 'converted', value: true }, times: 3 } };
    const migration = callError(migrate(context));
    await held;
    expect(await orders).toEqual([{ ok: true, value: null }]);
    expect((await migration).code).toBe('call_limit');
    expect(guestReplies().map((reply) => reply.ok)).toEqual([true, true, false]);
    expect(await kvGet(id, { key: 'orders' })).toEqual({ value: ['A Par-Bur'] });
    expect(await kvGet(id, { key: 'converted' })).toEqual({ value: null });
  });

  it('never runs a migration the update gave up on while it waited its turn, and leaves k/v alone', async () => {
    const { id, context } = await migrationContext(manifest({ dataVersion: 2 }));
    await kvSet(id, { key: 'game', value: { turn: 3 } });
    const storePath = join(directory, 'extensions', id, 'kv.json');
    const before = await readFile(storePath, 'utf8');
    const { held } = await holdQueue(id);

    const abandon = new AbortController();
    state.migrateAs = { action: 'host', input: { fn: 'kv_set', payload: { key: 'game', value: 'converted' } } };
    const migration = callError(migrate({ ...context, signal: abandon.signal }));
    await vi.waitFor(() => expect(state.runtimeCall).toHaveBeenCalledTimes(2));
    abandon.abort();
    await held;
    expect((await migration).code).toBe('failed');
    expect(state.migrateOutput).toBeNull();
    expect(await readFile(storePath, 'utf8')).toBe(before);
  });

  it("refuses a migration's record and timer writes once the update gives up on it", async () => {
    const { id, context } = await migrationContext(manifest({ dataVersion: 2 }));
    const at = new Date(Date.now() + 120_000).toISOString();

    const recordsAbandon = new AbortController();
    state.onForumWrite = () => recordsAbandon.abort();
    state.migrateAs = { action: 'host', input: { fn: 'record_create', payload: { collection: GAME, record: { turn: 1 } }, times: 2 } };
    await callError(migrate({ ...context, signal: recordsAbandon.signal }));
    expect(guestReplies()).toEqual([{ ok: true, value: expect.anything() }, { ok: false, error: expect.objectContaining({ code: 'host_error' }) }]);
    expect(state.forumWrites).toHaveLength(1);

    // Sets a key, writes a record (the update gives up during it), then sets a timer.
    const timersAbandon = new AbortController();
    state.onForumWrite = () => timersAbandon.abort();
    state.migrateAs = { action: 'effects', input: { value: { turn: 2 }, collection: GAME, record: { turn: 2 }, at } };
    await callError(migrate({ ...context, signal: timersAbandon.signal }));
    expect(JSON.parse(state.migrateOutput!).value).toMatchObject({ kv: { ok: true }, record: { ok: true }, timer: { ok: false, error: { code: 'host_error' } } });
    const timers = await readFile(join(directory, 'extensions', 'timers.json'), 'utf8').then((text) => JSON.parse(text).timers, () => []);
    expect(timers).toEqual([]);
    expect(await kvGet(id, { key: 'last' })).toEqual({ value: null });
  });
});
