import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { link, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Extension installs, bundles, and stores live under DATA_DIR/extensions, and
// only one process may run them at a time: during a rolling deploy the old and
// new containers share the volume. At boot the host takes this lock; a process
// that can't get it runs with extensions disabled.
//
// The lock is a file holding an owner token and a heartbeat the holder
// refreshes. It is only ever created with link(), which fails when the file
// exists, so two processes can't both create it. A holder that stops
// refreshing (it crashed) goes stale and the next process takes it over.

export const EXTENSIONS_LOCK_HEARTBEAT_MS = 10_000;
/** A heartbeat older than this means the holder is gone. */
export const EXTENSIONS_LOCK_STALE_MS = 60_000;

interface LockContents {
  token: string;
  pid: number;
  heartbeatAt: string;
}

export interface ExtensionsLock {
  /** Refresh the heartbeat now, or notice the lock was lost. The interval calls this too. */
  heartbeat(): Promise<void>;
  /** Give the lock up. Synchronous, so it can run from a process exit handler. */
  release(): void;
}

let heldToken: string | null = null;

/** Whether this process holds the extensions lock right now. */
export const extensionsLockHeld = () => heldToken !== null;

const lockPath = () => join(process.env.DATA_DIR ?? '.data', 'extensions', '.lock');

const contents = (token: string): string => JSON.stringify({ token, pid: process.pid, heartbeatAt: new Date().toISOString() } satisfies LockContents);

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** Create the lock file with its contents in one step, or return false when it already exists. */
async function create(path: string, token: string): Promise<boolean> {
  const draft = `${path}.${token}.new`;
  await writeFile(draft, contents(token));
  try {
    await link(draft, path);
    return true;
  } catch (error) {
    if (code(error) === 'EEXIST') return false;
    throw error;
  } finally {
    await unlink(draft).catch(() => {});
  }
}

/** The current lock file's raw text and whether it's stale, or null when there is none. */
async function inspect(path: string): Promise<{ raw: string; stale: boolean } | null> {
  try {
    const raw = await readFile(path, 'utf8');
    let beat: number;
    try {
      beat = Date.parse((JSON.parse(raw) as LockContents).heartbeatAt);
      if (Number.isNaN(beat)) throw new Error('no heartbeat');
    } catch {
      // Unreadable contents: judge by when the file was last written.
      beat = (await stat(path)).mtimeMs;
    }
    return { raw, stale: Date.now() - beat > EXTENSIONS_LOCK_STALE_MS };
  } catch (error) {
    if (code(error) === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Move a stale lock aside so a fresh one can be created. If what got moved
 * isn't the stale lock that was inspected, another process took over first;
 * put its lock back and give up.
 */
async function clearStale(path: string, seen: string, token: string): Promise<boolean> {
  const aside = `${path}.${token}.stale`;
  try {
    await rename(path, aside);
  } catch (error) {
    if (code(error) === 'ENOENT') return true;
    throw error;
  }
  const moved = await readFile(aside, 'utf8').catch(() => null);
  if (moved !== seen) {
    await link(aside, path).catch(() => {});
    await unlink(aside).catch(() => {});
    return false;
  }
  await unlink(aside).catch(() => {});
  return true;
}

function hold(path: string, token: string): ExtensionsLock {
  heldToken = token;
  let beating: Promise<void> = Promise.resolve();
  const lose = () => {
    if (heldToken === token) heldToken = null;
    clearInterval(timer);
  };

  const beat = async () => {
    if (heldToken !== token) return;
    try {
      const current = JSON.parse(await readFile(path, 'utf8')) as LockContents;
      if (current.token !== token) return lose();
      const draft = `${path}.${token}.beat`;
      await writeFile(draft, contents(token));
      await rename(draft, path);
    } catch (error) {
      // A missing or rewritten file means someone else has it; anything else is retried next beat.
      if (code(error) === 'ENOENT' || error instanceof SyntaxError) lose();
    }
  };

  const heartbeat = () => {
    beating = beating.then(beat);
    return beating;
  };
  const timer = setInterval(() => void heartbeat(), EXTENSIONS_LOCK_HEARTBEAT_MS);
  timer.unref();

  return {
    heartbeat,
    release() {
      const mine = heldToken === token;
      lose();
      if (!mine) return;
      try {
        if ((JSON.parse(readFileSync(path, 'utf8')) as LockContents).token === token) unlinkSync(path);
      } catch {
        // Already gone or replaced; nothing of ours to remove.
      }
    },
  };
}

/** Take the extensions lock, or return null when another live process (or this one) holds it. */
export async function acquireExtensionsLock(): Promise<ExtensionsLock | null> {
  if (heldToken) return null;
  const path = lockPath();
  await mkdir(join(path, '..'), { recursive: true });
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await create(path, token)) return hold(path, token);
    const existing = await inspect(path);
    if (!existing) continue;
    if (!existing.stale) return null;
    if (!(await clearStale(path, existing.raw, token))) return null;
  }
  return null;
}
