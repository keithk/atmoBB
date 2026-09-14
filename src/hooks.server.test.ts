import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// hooks.server.ts pulls in the whole boot-time side-effect chain (secrets,
// the notify sender key, session/presence helpers); none of that is this
// unit's concern, so it's stubbed out to isolate the `init` hook.
const state = vi.hoisted(() => ({
  building: false,
  acquireExtensionsLock: vi.fn(),
  startScheduler: vi.fn(),
  startMaintenance: vi.fn(),
  dispatchTimer: vi.fn(),
}));
vi.mock('$app/environment', () => ({
  get building() {
    return state.building;
  },
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/extensions/lock', () => ({ acquireExtensionsLock: state.acquireExtensionsLock }));
vi.mock('$lib/server/extensions/scheduler', () => ({ startScheduler: state.startScheduler }));
vi.mock('$lib/server/extensions/maintenance', () => ({ startMaintenance: state.startMaintenance }));
vi.mock('$lib/server/extensions/host', () => ({ dispatchTimer: state.dispatchTimer }));
vi.mock('$lib/server/secrets', () => ({ assertProductionSecrets: vi.fn() }));
vi.mock('$lib/server/notify/sender', () => ({ senderDid: () => null, senderKeypair: vi.fn() }));
vi.mock('$lib/server/session', () => ({ sessionDid: vi.fn() }));
vi.mock('$lib/server/appview', () => ({ resolveHandle: vi.fn() }));
vi.mock('$lib/server/presence', () => ({ touchGuest: vi.fn(), touchMember: vi.fn() }));

import { init } from './hooks.server';

beforeEach(() => {
  state.building = false;
  state.acquireExtensionsLock.mockReset();
  state.startScheduler.mockReset();
  state.startMaintenance.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('init', () => {
  it('does nothing while building: no lock attempt, no poller', async () => {
    state.building = true;
    await init();
    expect(state.acquireExtensionsLock).not.toHaveBeenCalled();
    expect(state.startScheduler).not.toHaveBeenCalled();
    expect(state.startMaintenance).not.toHaveBeenCalled();
  });

  it('does not start the poller when the extensions lock cannot be acquired', async () => {
    state.acquireExtensionsLock.mockResolvedValue(null);
    await init();
    expect(state.acquireExtensionsLock).toHaveBeenCalledTimes(1);
    expect(state.startScheduler).not.toHaveBeenCalled();
    expect(state.startMaintenance).not.toHaveBeenCalled();
  });

  it('starts the poller with the host dispatcher and the maintenance pass once the lock is held, and releases the lock on a shutdown signal', async () => {
    const release = vi.fn();
    state.acquireExtensionsLock.mockResolvedValue({ heartbeat: vi.fn(), release });
    const once = vi.spyOn(process, 'once');

    await init();

    expect(state.startScheduler).toHaveBeenCalledExactlyOnceWith({ dispatch: state.dispatchTimer });
    expect(state.startMaintenance).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    const signals = once.mock.calls.map(([signal]) => signal);
    expect(signals).toEqual(expect.arrayContaining(['SIGTERM', 'SIGINT']));
    for (const [, handler] of once.mock.calls) (handler as () => void)();
    expect(release).toHaveBeenCalledTimes(signals.length);

    once.mockRestore();
  });
});
