import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Member notification state and forum-wide counters, one JSON file each under
// DATA_DIR/notify/. Every mutation of a file runs on that file's own promise
// chain and lands via write-temp-then-rename, so concurrent callers never
// interleave a read-modify-write and a crash never leaves a half-written file.
// Functions throw on write failure; callers decide whether to fail open.

export type NotifyStatus = 'off' | 'pending' | 'on';
export type NotifyKind = 'thread-reply' | 'post-reply' | 'mention' | 'board-watch';
export type NotifyDelivery = 'pending' | 'sent' | 'undelivered' | 'skipped';

export interface NotifyEntry {
  id: string;
  at: string;
  kind: NotifyKind;
  title: string;
  body: string;
  url: string;
  read: boolean;
  delivery: NotifyDelivery;
}

export interface MemberNotifyState {
  status: NotifyStatus;
  // Forum clock: stamped on every transition, whoever initiated it.
  changedAt: string;
  // Relay clock: the changedAt of the last accepted callback, never a forum time.
  relayChangedAt?: string;
  promptDismissed: boolean;
  entries: NotifyEntry[];
}

export interface NotifyStats {
  sent: number;
  visited: number;
}

const MAX_ENTRIES = 100;

const notifyDir = () => join(process.env.DATA_DIR ?? '.data', 'notify');
const memberPath = (did: string) => join(notifyDir(), 'members', `${encodeURIComponent(did)}.json`);
const statsPath = () => join(notifyDir(), 'stats.json');

// One chain per file path. The map only grows with the member count, which
// is small for a forum, so entries are never evicted.
let chains = new Map<string, Promise<unknown>>();

export function resetStoreForTests() {
  chains = new Map();
}

function withFile<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(path) ?? Promise.resolve()).then(fn);
  chains.set(path, run.catch(() => {}));
  return run;
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

const freshMember = (): MemberNotifyState => ({
  status: 'off',
  changedAt: new Date().toISOString(),
  promptDismissed: false,
  entries: [],
});

export async function readMember(did: string): Promise<MemberNotifyState | null> {
  return ((await readJson(memberPath(did))) as MemberNotifyState | undefined) ?? null;
}

// Read-modify-write on the member's chain. `fn` returns false to leave the
// file untouched; anything else is written back.
function withMember<T>(did: string, fn: (member: MemberNotifyState) => T): Promise<T> {
  return withFile(memberPath(did), async () => {
    const member = (await readMember(did)) ?? freshMember();
    const out = fn(member);
    if (out !== false) await writeJson(memberPath(did), member);
    return out;
  });
}

// Forum-initiated transition: never compared against relay time.
export function setStatus(did: string, status: NotifyStatus): Promise<void> {
  return withMember(did, (member) => {
    member.status = status;
    member.changedAt = new Date().toISOString();
  });
}

// A relay callback. With a changedAt, only strictly older callbacks are
// dropped; without one it applies unconditionally and leaves the relay clock
// alone. Returns whether it was applied.
export function applyCallback(did: string, enabled: boolean, changedAt?: string): Promise<boolean> {
  return withMember(did, (member) => {
    if (changedAt !== undefined) {
      if (member.relayChangedAt !== undefined && changedAt < member.relayChangedAt) return false;
      member.relayChangedAt = changedAt;
    }
    member.status = enabled ? 'on' : 'off';
    member.changedAt = new Date().toISOString();
    return true;
  });
}

// After the relay answers pending: a fast callback may already have flipped
// the member on, in which case pending must not overwrite it.
export async function confirmPending(did: string): Promise<void> {
  await withMember(did, (member) => {
    if (member.status === 'on') return false;
    member.status = 'pending';
    member.changedAt = new Date().toISOString();
  });
}

export function setPromptDismissed(did: string): Promise<void> {
  return withMember(did, (member) => {
    member.promptDismissed = true;
  });
}

export function appendEntry(
  did: string,
  entry: Omit<NotifyEntry, 'id'> & { id?: string },
): Promise<NotifyEntry> {
  const full: NotifyEntry = { ...entry, id: entry.id ?? randomUUID() };
  return withMember(did, (member) => {
    member.entries.unshift(full);
    member.entries.length = Math.min(member.entries.length, MAX_ENTRIES);
    return full;
  });
}

export async function updateEntry(did: string, id: string, patch: Partial<Omit<NotifyEntry, 'id'>>): Promise<void> {
  await withMember(did, (member) => {
    const entry = member.entries.find((e) => e.id === id);
    if (!entry) return false;
    Object.assign(entry, patch);
  });
}

export function markRead(did: string, ids: string[] | 'all'): Promise<void> {
  return withMember(did, (member) => {
    for (const entry of member.entries) {
      if (ids === 'all' || ids.includes(entry.id)) entry.read = true;
    }
  });
}

export async function unreadCount(did: string): Promise<number> {
  const member = await readMember(did);
  return member ? member.entries.filter((e) => !e.read).length : 0;
}

const zeroStats = (): NotifyStats => ({ sent: 0, visited: 0 });

// Counters are approximate by design; a file that will not parse is reset
// rather than blocking every bump behind it.
export async function readStats(): Promise<NotifyStats> {
  let raw: unknown;
  try {
    raw = await readJson(statsPath());
  } catch (err) {
    console.warn('[notify] stats.json unreadable, resetting to zero:', err);
    return zeroStats();
  }
  if (raw === undefined) return zeroStats();
  const stats = raw as Partial<NotifyStats>;
  if (typeof stats.sent !== 'number' || typeof stats.visited !== 'number') {
    console.warn('[notify] stats.json malformed, resetting to zero');
    return zeroStats();
  }
  return { sent: stats.sent, visited: stats.visited };
}

export function bumpStats(field: keyof NotifyStats, by = 1): Promise<void> {
  return withFile(statsPath(), async () => {
    const stats = await readStats();
    stats[field] += by;
    await writeJson(statsPath(), stats);
  });
}
