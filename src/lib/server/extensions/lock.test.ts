import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXTENSIONS_LOCK_STALE_MS,
  acquireExtensionsLock,
  extensionsLockHeld,
  waitForExtensionsLock,
  type ExtensionsLock,
  type ExtensionsLockWait,
} from './lock';

let directory: string;
const held: ExtensionsLock[] = [];
const waits: ExtensionsLockWait[] = [];
const lockPath = () => join(directory, 'extensions', '.lock');

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-lock-test-'));
  vi.stubEnv('DATA_DIR', directory);
});
afterEach(async () => {
  for (const wait of waits.splice(0)) wait.stop();
  for (const lock of held.splice(0)) lock.release();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function acquire() {
  const lock = await acquireExtensionsLock();
  if (lock) held.push(lock);
  return lock;
}

describe('acquireExtensionsLock', () => {
  it('holds the lock until released, refusing a second acquire meanwhile', async () => {
    expect(extensionsLockHeld()).toBe(false);
    const first = await acquire();
    expect(first).not.toBeNull();
    expect(extensionsLockHeld()).toBe(true);
    expect(await acquire()).toBeNull();
    expect(extensionsLockHeld()).toBe(true);

    first!.release();
    expect(extensionsLockHeld()).toBe(false);
    await expect(stat(lockPath())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await acquire()).not.toBeNull();
  });

  it('refuses a lock another process holds with a fresh heartbeat', async () => {
    await mkdir(join(directory, 'extensions'), { recursive: true });
    await writeFile(lockPath(), JSON.stringify({ token: 'other', pid: 1, heartbeatAt: new Date().toISOString() }));
    expect(await acquire()).toBeNull();
    expect(extensionsLockHeld()).toBe(false);
    expect(JSON.parse(await readFile(lockPath(), 'utf8')).token).toBe('other');
  });

  it('takes over a lock whose heartbeat has gone stale', async () => {
    await mkdir(join(directory, 'extensions'), { recursive: true });
    const old = new Date(Date.now() - EXTENSIONS_LOCK_STALE_MS - 1000).toISOString();
    await writeFile(lockPath(), JSON.stringify({ token: 'crashed', pid: 1, heartbeatAt: old }));
    const lock = await acquire();
    expect(lock).not.toBeNull();
    expect(extensionsLockHeld()).toBe(true);
    expect(JSON.parse(await readFile(lockPath(), 'utf8')).token).not.toBe('crashed');
  });

  it('takes over an unreadable lock file only once it is stale by modification time', async () => {
    await mkdir(join(directory, 'extensions'), { recursive: true });
    await writeFile(lockPath(), 'not json');
    expect(await acquire()).toBeNull();
  });

  it('refreshes its heartbeat and gives up the lock when another owner replaces it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const lock = await acquire();
    const before = JSON.parse(await readFile(lockPath(), 'utf8')).heartbeatAt;
    vi.advanceTimersByTime(60_000);
    await lock!.heartbeat();
    expect(JSON.parse(await readFile(lockPath(), 'utf8')).heartbeatAt).not.toBe(before);

    await writeFile(lockPath(), JSON.stringify({ token: 'thief', pid: 1, heartbeatAt: new Date().toISOString() }));
    await lock!.heartbeat();
    expect(extensionsLockHeld()).toBe(false);
    lock!.release();
    expect(JSON.parse(await readFile(lockPath(), 'utf8')).token).toBe('thief');
  });
});

describe('ExtensionsLock.lost', () => {
  it('resolves when a heartbeat finds another owner, and not when the lock is released', async () => {
    const taken = await acquire();
    let takenLost = false;
    void taken!.lost.then(() => (takenLost = true));
    await writeFile(lockPath(), JSON.stringify({ token: 'thief', pid: 1, heartbeatAt: new Date().toISOString() }));
    await taken!.heartbeat();
    await Promise.resolve();
    expect(takenLost).toBe(true);

    await unlink(lockPath());
    const released = await acquire();
    let releasedLost = false;
    void released!.lost.then(() => (releasedLost = true));
    released!.release();
    await released!.heartbeat();
    await Promise.resolve();
    expect(releasedLost).toBe(false);
  });
});

describe('waitForExtensionsLock', () => {
  const holdElsewhere = async () => {
    await mkdir(join(directory, 'extensions'), { recursive: true });
    await writeFile(lockPath(), JSON.stringify({ token: 'other', pid: 1, heartbeatAt: new Date().toISOString() }));
  };

  function wait(intervalMs = 10) {
    const acquired: ExtensionsLock[] = [];
    const handle = waitForExtensionsLock((lock) => {
      held.push(lock);
      acquired.push(lock);
    }, intervalMs);
    waits.push(handle);
    return { handle, acquired };
  }

  it('hands over the lock on the first try when it is free', async () => {
    const { handle, acquired } = wait();
    await handle.firstAttempt;
    expect(acquired).toHaveLength(1);
    expect(extensionsLockHeld()).toBe(true);
  });

  it('keeps trying after a refused first try and takes the lock once the holder releases it', async () => {
    await holdElsewhere();
    const { handle, acquired } = wait();
    await handle.firstAttempt;
    expect(acquired).toHaveLength(0);
    expect(extensionsLockHeld()).toBe(false);

    await unlink(lockPath());
    await vi.waitFor(() => expect(acquired).toHaveLength(1));
    expect(extensionsLockHeld()).toBe(true);
    expect(JSON.parse(await readFile(lockPath(), 'utf8')).token).not.toBe('other');
  });

  it('stops trying once stopped', async () => {
    await holdElsewhere();
    const { handle, acquired } = wait();
    await handle.firstAttempt;
    handle.stop();
    await unlink(lockPath());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(acquired).toHaveLength(0);
    expect(extensionsLockHeld()).toBe(false);
  });
});
