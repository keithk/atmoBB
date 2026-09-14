import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  getInstall: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('./registry', () => ({ getInstall: (...args: unknown[]) => state.getInstall(...args) }));

import {
  TimerCapExceededError,
  TimerDelayTooShortError,
  cancelTimer,
  pollTimers,
  purgeInstallTimers,
  scheduleTimer,
  startScheduler,
} from './scheduler';

let directory: string;
const INSTALL = 'install-a';
const OTHER = 'install-b';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-scheduler-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.getInstall.mockReset();
  state.getInstall.mockResolvedValue({ id: INSTALL, state: 'active' });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

describe('scheduleTimer caps', () => {
  it('rejects scheduling below the minimum delay', async () => {
    await expect(scheduleTimer(INSTALL, { name: 'soon', at: new Date(Date.now() + 1000).toISOString() })).rejects.toBeInstanceOf(
      TimerDelayTooShortError,
    );
  });

  it('rejects scheduling past the pending-timer cap, but a replace never counts against it', async () => {
    state.env.ATMOBB_EXTENSIONS_TIMER_CAP = '2';
    await scheduleTimer(INSTALL, { name: 'a', at: new Date(Date.now() + 120_000).toISOString() });
    await scheduleTimer(INSTALL, { name: 'b', at: new Date(Date.now() + 120_000).toISOString() });
    await expect(scheduleTimer(INSTALL, { name: 'c', at: new Date(Date.now() + 120_000).toISOString() })).rejects.toBeInstanceOf(
      TimerCapExceededError,
    );
    await expect(scheduleTimer(INSTALL, { name: 'a', at: new Date(Date.now() + 130_000).toISOString() })).resolves.toBeUndefined();
  });
});

describe('pollTimers', () => {
  it('fires a timer due in the past on the next tick, and only once when the handler succeeds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await scheduleTimer(INSTALL, { name: 'deadline', at: new Date(Date.now() + 60_000).toISOString() });
    vi.setSystemTime(Date.now() + 61_000);

    const dispatch = vi.fn().mockResolvedValue(undefined);
    await pollTimers({ dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(INSTALL, expect.objectContaining({ name: 'deadline' }));

    await pollTimers({ dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('leaves a throwing handler for retry with backoff, firing again only once the backoff elapses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await scheduleTimer(INSTALL, { name: 'ping', at: new Date(Date.now() + 60_000).toISOString() });
    vi.setSystemTime(Date.now() + 61_000);

    const dispatch = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    await pollTimers({ dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);

    // Too soon: the backoff hasn't elapsed yet.
    await pollTimers({ dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 60_000);
    await pollTimers({ dispatch });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('cancel removes a pending timer; re-setting a name replaces it instead of adding a second', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await scheduleTimer(INSTALL, { name: 'x', at: new Date(Date.now() + 120_000).toISOString() });
    await cancelTimer(INSTALL, 'x');
    vi.setSystemTime(Date.now() + 121_000);
    await pollTimers({ dispatch });
    expect(dispatch).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await scheduleTimer(INSTALL, { name: 'y', at: new Date(Date.now() + 120_000).toISOString(), payload: 'first' });
    await scheduleTimer(INSTALL, { name: 'y', at: new Date(Date.now() + 180_000).toISOString(), payload: 'second' });
    vi.setSystemTime(Date.now() + 121_000);
    await pollTimers({ dispatch });
    expect(dispatch).not.toHaveBeenCalled(); // the replaced (later) time isn't due yet
    vi.setSystemTime(Date.now() + 60_000);
    await pollTimers({ dispatch });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(INSTALL, expect.objectContaining({ payload: 'second' }));
  });

  it('fires overdue timers after a simulated restart on the same store', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await scheduleTimer(INSTALL, { name: 'restart-me', at: new Date(Date.now() + 60_000).toISOString() });
    vi.setSystemTime(Date.now() + 61_000);

    vi.resetModules();
    const fresh = await import('./scheduler');
    const dispatch = vi.fn().mockResolvedValue(undefined);
    await fresh.pollTimers({ dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('drops a due timer for a disabled install instead of firing it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await scheduleTimer(INSTALL, { name: 'x', at: new Date(Date.now() + 60_000).toISOString() });
    state.getInstall.mockResolvedValue({ id: INSTALL, state: 'disabled' });
    vi.setSystemTime(Date.now() + 61_000);

    const dispatch = vi.fn().mockResolvedValue(undefined);
    await pollTimers({ dispatch });
    expect(dispatch).not.toHaveBeenCalled();

    // Confirm it was dropped, not merely deferred: re-enabling doesn't bring it back.
    state.getInstall.mockResolvedValue({ id: INSTALL, state: 'active' });
    await pollTimers({ dispatch });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('drops a due timer whose install no longer exists', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await scheduleTimer(INSTALL, { name: 'x', at: new Date(Date.now() + 60_000).toISOString() });
    state.getInstall.mockResolvedValue(null);
    vi.setSystemTime(Date.now() + 61_000);

    const dispatch = vi.fn().mockResolvedValue(undefined);
    await pollTimers({ dispatch });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('purgeInstallTimers', () => {
  it('removes every timer for one install, leaving other installs alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await scheduleTimer(INSTALL, { name: 'a', at: new Date(Date.now() + 60_000).toISOString() });
    await scheduleTimer(OTHER, { name: 'a', at: new Date(Date.now() + 60_000).toISOString() });
    await purgeInstallTimers(INSTALL);
    vi.setSystemTime(Date.now() + 61_000);

    const dispatch = vi.fn().mockResolvedValue(undefined);
    await pollTimers({ dispatch });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(OTHER, expect.anything());
  });
});

describe('startScheduler', () => {
  it('starts the poller only once, with its interval unref\'d', () => {
    const spy = vi.spyOn(global, 'setInterval');
    const first = startScheduler({ dispatch: vi.fn() });
    const second = startScheduler({ dispatch: vi.fn() });
    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);

    const timer = spy.mock.results[0]!.value as NodeJS.Timeout;
    expect(timer.hasRef?.()).toBe(false);

    first.stop();
    spy.mockRestore();
  });
});
