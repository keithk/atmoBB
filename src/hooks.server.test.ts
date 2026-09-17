import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// hooks.server.ts pulls in the whole boot-time side-effect chain (secrets,
// the notify sender key, session/presence helpers); none of that is this
// unit's concern, so it's stubbed out to isolate the `init` hook.
const state = vi.hoisted(() => ({
  building: false,
  events: [] as string[],
  waitForExtensionsLock: vi.fn(),
  startScheduler: vi.fn(),
  startMaintenance: vi.fn(),
  rebuildBindingsInBackground: vi.fn(),
  closeExtensionHost: vi.fn(),
  dispatchTimer: vi.fn(),
}));
vi.mock('$app/environment', () => ({
  get building() {
    return state.building;
  },
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/extensions/lock', () => ({ waitForExtensionsLock: state.waitForExtensionsLock }));
vi.mock('$lib/server/extensions/scheduler', () => ({ startScheduler: state.startScheduler }));
vi.mock('$lib/server/extensions/maintenance', () => ({ startMaintenance: state.startMaintenance }));
vi.mock('$lib/server/extensions/bindings', () => ({ rebuildBindingsInBackground: state.rebuildBindingsInBackground }));
vi.mock('$lib/server/extensions/host', () => ({ dispatchTimer: state.dispatchTimer, closeExtensionHost: state.closeExtensionHost }));
vi.mock('$lib/server/secrets', () => ({ assertProductionSecrets: vi.fn() }));
vi.mock('$lib/server/notify/sender', () => ({ senderDid: () => null, senderKeypair: vi.fn() }));
vi.mock('$lib/server/session', () => ({ sessionDid: vi.fn() }));
vi.mock('$lib/server/appview', () => ({ resolveHandle: vi.fn() }));
vi.mock('$lib/server/presence', () => ({ touchGuest: vi.fn(), touchMember: vi.fn() }));

// The hook keeps its extension state at module level, so each test loads a fresh copy.
let init: typeof import('./hooks.server').init;

// init registers process listeners; capture them instead of attaching them to the test runner.
let listeners: Map<string, () => void>;

function fakeLock() {
  let loseIt!: () => void;
  const lost = new Promise<void>((resolve) => (loseIt = resolve));
  return { heartbeat: vi.fn(), release: vi.fn(() => state.events.push('release')), lost, loseIt };
}

beforeEach(async () => {
  vi.resetModules();
  ({ init } = await import('./hooks.server'));
  state.building = false;
  state.events = [];
  listeners = new Map();
  vi.spyOn(process, 'once').mockImplementation(((event: string, listener: () => void) => {
    listeners.set(event, listener);
    return process;
  }) as typeof process.once);
  state.waitForExtensionsLock.mockReset().mockReturnValue({ firstAttempt: Promise.resolve(), stop: vi.fn() });
  state.startScheduler.mockReset().mockReturnValue({ stop: () => state.events.push('stop scheduler') });
  state.startMaintenance.mockReset().mockReturnValue({ stop: () => state.events.push('stop maintenance') });
  state.rebuildBindingsInBackground.mockReset();
  state.closeExtensionHost.mockReset().mockImplementation(async () => {
    await Promise.resolve();
    state.events.push('close host');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const acquire = (lock: ReturnType<typeof fakeLock>) => (state.waitForExtensionsLock.mock.lastCall![0] as (lock: unknown) => void)(lock);

describe('init', () => {
  it('does nothing while building: no lock attempt, no poller', async () => {
    state.building = true;
    await init();
    expect(state.waitForExtensionsLock).not.toHaveBeenCalled();
    expect(state.startScheduler).not.toHaveBeenCalled();
    expect(state.startMaintenance).not.toHaveBeenCalled();
  });

  it('does not start the poller until the extensions lock is handed over, then starts it once', async () => {
    await init();
    expect(state.waitForExtensionsLock).toHaveBeenCalledTimes(1);
    expect(state.startScheduler).not.toHaveBeenCalled();

    acquire(fakeLock());
    expect(state.startScheduler).toHaveBeenCalledExactlyOnceWith({ dispatch: state.dispatchTimer });
    expect(state.startMaintenance).toHaveBeenCalledTimes(1);
    expect(state.rebuildBindingsInBackground).toHaveBeenCalledTimes(1);
  });

  it('releases the lock only after adapter-node has drained, once timers are stopped and instances closed', async () => {
    await init();
    const lock = fakeLock();
    acquire(lock);
    expect([...listeners.keys()]).not.toContain('SIGTERM');
    expect(lock.release).not.toHaveBeenCalled();

    listeners.get('sveltekit:shutdown')!();
    await vi.waitFor(() => expect(lock.release).toHaveBeenCalledTimes(1));
    expect(state.events).toEqual(['stop scheduler', 'stop maintenance', 'close host', 'release']);
  });

  it('stops extensions and tries for the lock again when another process takes it over', async () => {
    await init();
    const lock = fakeLock();
    acquire(lock);
    lock.loseIt();
    await vi.waitFor(() => expect(state.waitForExtensionsLock).toHaveBeenCalledTimes(2));
    expect(state.events).toEqual(['stop scheduler', 'stop maintenance', 'close host']);
  });
});
