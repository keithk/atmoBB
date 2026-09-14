import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TimerSet } from '$lib/extensions/contract';
import { envInt } from './env';
import { getInstall } from './registry';

// Extensions have no job runner, so timed callbacks live in one JSON file at
// DATA_DIR/extensions/timers.json, keyed by (installId, name), and a single
// poller checks it every POLL_INTERVAL_MS. Delivery is at least once: a timer
// is removed only once its dispatch resolves, so a crash between firing and
// removal fires it again on the next boot, and handlers must tolerate that. A
// dispatch that throws leaves the timer in place with a backed-off retry time
// instead of losing it. A due timer whose install is gone or disabled is
// dropped rather than fired or retried.

export type TimerDispatcher = (installId: string, timer: TimerSet) => Promise<void>;

/** Thrown by scheduleTimer when `at` is sooner than the minimum delay. */
export class TimerDelayTooShortError extends Error {
  constructor(public readonly minDelayMs: number) {
    super(`Timers must be scheduled at least ${minDelayMs}ms from now`);
    this.name = 'TimerDelayTooShortError';
  }
}

/** Thrown by scheduleTimer when an install already has as many pending timers as its cap. */
export class TimerCapExceededError extends Error {
  constructor(
    public readonly installId: string,
    public readonly cap: number,
  ) {
    super(`Install ${installId} already has ${cap} pending timers, the limit`);
    this.name = 'TimerCapExceededError';
  }
}

export const POLL_INTERVAL_MS = 30_000;
const DEFAULT_MIN_DELAY_MS = 60_000;
const DEFAULT_TIMER_CAP = 200;
/** Doubles per failed attempt, capped, so a broken dispatcher doesn't hammer a handler forever. */
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/** ATMOBB_EXTENSIONS_TIMER_MIN_DELAY_MS: how soon after scheduling a timer may fire. */
const minDelayMs = () => envInt('ATMOBB_EXTENSIONS_TIMER_MIN_DELAY_MS', DEFAULT_MIN_DELAY_MS);
/** ATMOBB_EXTENSIONS_TIMER_CAP: pending timers allowed per install. */
const timerCap = () => envInt('ATMOBB_EXTENSIONS_TIMER_CAP', DEFAULT_TIMER_CAP);

const extensionsRoot = () => join(process.env.DATA_DIR ?? '.data', 'extensions');
const storePath = () => join(extensionsRoot(), 'timers.json');

interface StoredTimer {
  installId: string;
  name: string;
  /** ISO 8601 datetime the extension asked for; passed to dispatch as-is, even on a retried attempt. */
  at: string;
  payload: unknown;
  attempts: number;
  /** ISO 8601 datetime this timer is next eligible to fire. Equals `at` until the first failed attempt. */
  nextAttemptAt: string;
}

interface TimersFile {
  timers: StoredTimer[];
}

async function loadStore(): Promise<TimersFile> {
  try {
    return JSON.parse(await readFile(storePath(), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { timers: [] };
  }
}

async function saveStore(store: TimersFile) {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2));
  await rename(tmp, path);
}

// One mutation at a time; the store is a single JSON file shared by every install.
let chain: Promise<unknown> = Promise.resolve();
function withStore<T>(fn: (store: TimersFile) => Promise<T> | T): Promise<T> {
  const run = chain.then(async () => {
    const store = await loadStore();
    const out = await fn(store);
    await saveStore(store);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

/** Schedule a timed callback, replacing any pending timer with the same name for this install. */
export async function scheduleTimer(installId: string, timer: TimerSet): Promise<void> {
  const at = new Date(timer.at);
  if (at.getTime() - Date.now() < minDelayMs()) throw new TimerDelayTooShortError(minDelayMs());
  await withStore((store) => {
    const index = store.timers.findIndex((t) => t.installId === installId && t.name === timer.name);
    if (index === -1) {
      const pending = store.timers.filter((t) => t.installId === installId).length;
      if (pending >= timerCap()) throw new TimerCapExceededError(installId, timerCap());
    }
    const stored: StoredTimer = {
      installId,
      name: timer.name,
      at: at.toISOString(),
      payload: timer.payload,
      attempts: 0,
      nextAttemptAt: at.toISOString(),
    };
    if (index === -1) store.timers.push(stored);
    else store.timers[index] = stored;
  });
}

/** Cancel a pending timer. A no-op when there is none by that name. */
export async function cancelTimer(installId: string, name: string): Promise<void> {
  await withStore((store) => {
    store.timers = store.timers.filter((t) => !(t.installId === installId && t.name === name));
  });
}

/** Remove every pending timer for an install, e.g. once its uninstall grace period elapses. */
export async function purgeInstallTimers(installId: string): Promise<void> {
  await withStore((store) => {
    store.timers = store.timers.filter((t) => t.installId !== installId);
  });
}

const backoffMs = (attempts: number) => Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);

/** Until the host registers a real dispatcher, every dispatch fails, so timers stay pending instead of being silently dropped or fired into the void. */
const noDispatcher: TimerDispatcher = async () => {
  throw new Error('No extension timer dispatcher is registered yet');
};

export interface PollOptions {
  dispatch?: TimerDispatcher;
  now?: () => Date;
}

const sameTimer = (a: StoredTimer, b: StoredTimer) =>
  a.installId === b.installId && a.name === b.name && a.at === b.at && a.nextAttemptAt === b.nextAttemptAt && a.attempts === b.attempts;

let polling: Promise<void> | null = null;

/**
 * Fire every due timer once through `dispatch`, dropping timers for installs
 * that are gone or disabled. Handlers run outside the store's lock, because
 * a handler may set or cancel timers itself; a timer it replaced or cancelled
 * while running is left as the handler left it. A poll that starts while
 * another is still running waits for that one instead of firing again.
 */
export function pollTimers(options: PollOptions = {}): Promise<void> {
  polling ??= fireDue(options).finally(() => {
    polling = null;
  });
  return polling;
}

async function fireDue(options: PollOptions): Promise<void> {
  const dispatch = options.dispatch ?? noDispatcher;
  const now = options.now ?? (() => new Date());
  const current = now().getTime();
  const due = await withStore(async (store) => {
    const fire: StoredTimer[] = [];
    for (const timer of store.timers.filter((t) => new Date(t.nextAttemptAt).getTime() <= current)) {
      const install = await getInstall(timer.installId);
      if (install?.state === 'active') fire.push({ ...timer });
      else store.timers = store.timers.filter((t) => t !== timer);
    }
    return fire;
  });
  for (const timer of due) {
    let failed = false;
    try {
      await dispatch(timer.installId, { name: timer.name, at: timer.at, payload: timer.payload });
    } catch {
      failed = true;
    }
    await withStore((store) => {
      const stored = store.timers.find((t) => sameTimer(t, timer));
      if (!stored) return;
      if (!failed) {
        store.timers = store.timers.filter((t) => t !== stored);
        return;
      }
      stored.attempts += 1;
      stored.nextAttemptAt = new Date(current + backoffMs(stored.attempts)).toISOString();
    });
  }
}

export interface SchedulerHandle {
  stop(): void;
}

let running: SchedulerHandle | null = null;

/**
 * Start the poller, unref'd so it never keeps the process alive on its own.
 * Idempotent: calling this again while it's already running returns the same
 * handle instead of starting a second interval.
 */
export function startScheduler(options: PollOptions & { intervalMs?: number } = {}): SchedulerHandle {
  if (running) return running;
  const interval = setInterval(() => void pollTimers(options), options.intervalMs ?? POLL_INTERVAL_MS);
  interval.unref?.();
  running = {
    stop() {
      clearInterval(interval);
      running = null;
    },
  };
  return running;
}
