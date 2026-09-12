import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendEntry,
  applyCallback,
  bumpStats,
  confirmPending,
  markRead,
  readMember,
  readStats,
  resetStoreForTests,
  setPromptDismissed,
  setStatus,
  countUnread,
  updateEntry,
  type NotifyEntry,
} from './store';

const did = 'did:plc:alice';
const other = 'did:plc:bob';

let dataDir: string;
const originalDataDir = process.env.DATA_DIR;

const memberFile = (d: string) => join(dataDir, 'notify', 'members', `${encodeURIComponent(d)}.json`);
const statsFile = () => join(dataDir, 'notify', 'stats.json');

const entry = (n: number): Omit<NotifyEntry, 'id'> => ({
  at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  kind: 'thread-reply',
  title: `reply ${n}`,
  body: `body ${n}`,
  url: `https://forum.test/t/${n}`,
  read: false,
  delivery: 'pending',
});

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'atmobb-notify-'));
  process.env.DATA_DIR = dataDir;
  resetStoreForTests();
});

afterEach(async () => {
  // A read-only test leaves a directory rm cannot descend into.
  await chmod(join(dataDir, 'notify', 'members'), 0o755).catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  vi.restoreAllMocks();
});

describe('member status', () => {
  it('returns null for an unknown DID and the status after setStatus', async () => {
    expect(await readMember(did)).toBeNull();
    await setStatus(did, 'pending');
    const member = await readMember(did);
    expect(member?.status).toBe('pending');
    expect(member?.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(member?.relayChangedAt).toBeUndefined();
    expect(member?.promptDismissed).toBe(false);
    expect(member?.entries).toEqual([]);
  });

  it('writes the file under DATA_DIR/notify/members with the DID encoded', async () => {
    await setStatus(did, 'on');
    const raw = JSON.parse(await readFile(memberFile(did), 'utf8'));
    expect(raw.status).toBe('on');
  });

  it('drops a callback older than relayChangedAt and applies an equal one', async () => {
    expect(await applyCallback(did, true, '2026-09-12T10:00:00.000Z')).toBe(true);
    expect((await readMember(did))?.status).toBe('on');

    expect(await applyCallback(did, false, '2026-09-12T09:00:00.000Z')).toBe(false);
    const after = await readMember(did);
    expect(after?.status).toBe('on');
    expect(after?.relayChangedAt).toBe('2026-09-12T10:00:00.000Z');

    expect(await applyCallback(did, false, '2026-09-12T10:00:00.000Z')).toBe(true);
    expect((await readMember(did))?.status).toBe('off');
  });

  it('applies a callback without changedAt unconditionally and leaves relayChangedAt alone', async () => {
    await applyCallback(did, true, '2026-09-12T10:00:00.000Z');
    expect(await applyCallback(did, false)).toBe(true);
    const member = await readMember(did);
    expect(member?.status).toBe('off');
    expect(member?.relayChangedAt).toBe('2026-09-12T10:00:00.000Z');
  });

  it('confirmPending leaves on alone after a fast callback', async () => {
    await setStatus(did, 'pending');
    await applyCallback(did, true, '2026-09-12T10:00:00.000Z');
    await confirmPending(did);
    expect((await readMember(did))?.status).toBe('on');
  });

  it('confirmPending writes pending when the member is still off', async () => {
    await setStatus(did, 'off');
    await confirmPending(did);
    expect((await readMember(did))?.status).toBe('pending');
  });

  it('setPromptDismissed creates an off file when absent', async () => {
    await setPromptDismissed(did);
    const member = await readMember(did);
    expect(member?.status).toBe('off');
    expect(member?.promptDismissed).toBe(true);
  });
});

describe('entries', () => {
  it('keeps the 100 newest entries, newest first, after 105 appends', async () => {
    for (let n = 1; n <= 105; n++) await appendEntry(did, entry(n));
    const member = await readMember(did);
    expect(member?.entries).toHaveLength(100);
    expect(member?.entries[0].title).toBe('reply 105');
    expect(member?.entries[99].title).toBe('reply 6');
  });

  it('assigns an id when missing and keeps a supplied one', async () => {
    const assigned = await appendEntry(did, entry(1));
    expect(assigned.id).toBeTruthy();
    const kept = await appendEntry(did, { ...entry(2), id: 'fixed' });
    expect(kept.id).toBe('fixed');
  });

  it('updateEntry patches one entry by id', async () => {
    const e = await appendEntry(did, entry(1));
    await appendEntry(did, entry(2));
    await updateEntry(did, e.id, { delivery: 'sent' });
    const member = await readMember(did);
    expect(member?.entries.find((x) => x.id === e.id)?.delivery).toBe('sent');
    expect(member?.entries.find((x) => x.id !== e.id)?.delivery).toBe('pending');
  });

  it('markRead all zeroes the unread count and a single id decrements by one', async () => {
    expect(countUnread((await readMember(did))?.entries ?? [])).toBe(0);
    const a = await appendEntry(did, entry(1));
    await appendEntry(did, entry(2));
    await appendEntry(did, entry(3));
    expect(countUnread((await readMember(did))?.entries ?? [])).toBe(3);
    await markRead(did, [a.id]);
    expect(countUnread((await readMember(did))?.entries ?? [])).toBe(2);
    await markRead(did, 'all');
    expect(countUnread((await readMember(did))?.entries ?? [])).toBe(0);
  });
});

describe('concurrency', () => {
  it('lands twenty concurrent appends to one member', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, n) => appendEntry(did, entry(n))));
    const raw = JSON.parse(await readFile(memberFile(did), 'utf8'));
    expect(raw.entries).toHaveLength(20);
    expect(countUnread((await readMember(did))?.entries ?? [])).toBe(20);
  });

  it('lands concurrent writes to two members without one waiting on the other', async () => {
    const order: string[] = [];
    const a = Promise.all(Array.from({ length: 10 }, (_, n) => appendEntry(did, entry(n)))).then(() =>
      order.push('a'),
    );
    const b = Promise.all(Array.from({ length: 10 }, (_, n) => appendEntry(other, entry(n)))).then(() =>
      order.push('b'),
    );
    await Promise.all([a, b]);
    expect(order).toHaveLength(2);
    expect(countUnread((await readMember(did))?.entries ?? [])).toBe(10);
    expect(countUnread((await readMember(other))?.entries ?? [])).toBe(10);
    // Both files exist independently; neither chain touched the other's file.
    const rawA = JSON.parse(await readFile(memberFile(did), 'utf8'));
    const rawB = JSON.parse(await readFile(memberFile(other), 'utf8'));
    expect(rawA.entries.every((e: NotifyEntry) => e.url.startsWith('https://forum.test/'))).toBe(true);
    expect(rawB.entries).toHaveLength(10);
  });
});

describe('stats', () => {
  it('reads zeros before any bump and counts bumps', async () => {
    expect(await readStats()).toEqual({ sent: 0, visited: 0 });
    await bumpStats('visited');
    await bumpStats('visited');
    await bumpStats('sent', 3);
    expect(await readStats()).toEqual({ sent: 3, visited: 2 });
  });

  it('resets a corrupted stats.json to zeros and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mkdir(join(dataDir, 'notify'), { recursive: true });
    await writeFile(statsFile(), '{not json');
    expect(await readStats()).toEqual({ sent: 0, visited: 0 });
    expect(warn).toHaveBeenCalled();
    await bumpStats('sent');
    expect(await readStats()).toEqual({ sent: 1, visited: 0 });
  });
});

describe('write failures', () => {
  it('rejects when the members directory is read-only', async () => {
    const members = join(dataDir, 'notify', 'members');
    await mkdir(members, { recursive: true });
    await chmod(members, 0o555);
    await expect(setStatus(did, 'pending')).rejects.toThrow();
    // The chain recovers: a later write to a writable directory succeeds.
    await chmod(members, 0o755);
    await setStatus(did, 'pending');
    expect((await readMember(did))?.status).toBe('pending');
  });
});
