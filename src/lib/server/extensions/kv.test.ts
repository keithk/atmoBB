import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
// Spies on `rename` directly, so a single write can be made to fail mid-write.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
import { KV_UNINSTALL_GRACE_MS, KvQuotaError, kvDelete, kvGet, kvList, kvSet, purgeUninstalledKv } from './kv';

let directory: string;
const storePath = (installId: string) => join(directory, 'extensions', installId, 'kv.json');

// Fresh install ids each test, since the write-rate limiter and the write
// queue are process-lifetime, keyed by install id, and not reset by the
// fresh DATA_DIR below.
let INSTALL: string;
let OTHER: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-kv-test-'));
  vi.stubEnv('DATA_DIR', directory);
  for (const key of Object.keys(state.env)) delete state.env[key];
  INSTALL = randomUUID();
  OTHER = randomUUID();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('get, set, delete', () => {
  it('returns a set value from get, null once deleted, and null for a key never set', async () => {
    expect(await kvGet(INSTALL, { key: 'missing' })).toEqual({ value: null });
    await kvSet(INSTALL, { key: 'a', value: { hp: 3 } });
    expect(await kvGet(INSTALL, { key: 'a' })).toEqual({ value: { hp: 3 } });
    await kvDelete(INSTALL, { key: 'a' });
    expect(await kvGet(INSTALL, { key: 'a' })).toEqual({ value: null });
  });

  it('survives a restart: a fresh read of the same DATA_DIR sees the same value', async () => {
    await kvSet(INSTALL, { key: 'a', value: 42 });
    vi.resetModules();
    const fresh = await import('./kv');
    expect(await fresh.kvGet(INSTALL, { key: 'a' })).toEqual({ value: 42 });
  });

  it('keeps two installs with the same key separate', async () => {
    await kvSet(INSTALL, { key: 'shared', value: 'one' });
    await kvSet(OTHER, { key: 'shared', value: 'two' });
    expect(await kvGet(INSTALL, { key: 'shared' })).toEqual({ value: 'one' });
    expect(await kvGet(OTHER, { key: 'shared' })).toEqual({ value: 'two' });
  });

  it('lands both of two concurrent sets on the same install', async () => {
    await Promise.all([kvSet(INSTALL, { key: 'x', value: 1 }), kvSet(INSTALL, { key: 'y', value: 2 })]);
    expect(await kvGet(INSTALL, { key: 'x' })).toEqual({ value: 1 });
    expect(await kvGet(INSTALL, { key: 'y' })).toEqual({ value: 2 });
  });

  it('stores __proto__ and constructor as plain data without touching the prototype, or other keys', async () => {
    await kvSet(INSTALL, { key: 'normal', value: 'safe' });
    await kvSet(INSTALL, { key: '__proto__', value: { polluted: true } });
    await kvSet(INSTALL, { key: 'constructor', value: 'also data' });
    expect(await kvGet(INSTALL, { key: '__proto__' })).toEqual({ value: { polluted: true } });
    expect(await kvGet(INSTALL, { key: 'constructor' })).toEqual({ value: 'also data' });
    expect(await kvGet(INSTALL, { key: 'normal' })).toEqual({ value: 'safe' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('prefix listing', () => {
  it('returns only matching keys, sorted', async () => {
    await kvSet(INSTALL, { key: 'game:1:order', value: 1 });
    await kvSet(INSTALL, { key: 'game:2:order', value: 2 });
    await kvSet(INSTALL, { key: 'game:10:order', value: 3 });
    await kvSet(INSTALL, { key: 'other:1', value: 4 });
    const result = await kvList(INSTALL, { prefix: 'game:' });
    // Plain string sort order, not numeric: '1' < ':' so "game:10:..." sorts before "game:2:...".
    expect(result.keys).toEqual(['game:10:order', 'game:1:order', 'game:2:order']);
    expect(result.cursor).toBeNull();
  });

  it('pages with limit and cursor', async () => {
    await kvSet(INSTALL, { key: 'a', value: 1 });
    await kvSet(INSTALL, { key: 'b', value: 2 });
    await kvSet(INSTALL, { key: 'c', value: 3 });
    const first = await kvList(INSTALL, { prefix: '', limit: 2 });
    expect(first.keys).toEqual(['a', 'b']);
    expect(first.cursor).toBe('b');
    const second = await kvList(INSTALL, { prefix: '', limit: 2, cursor: first.cursor! });
    expect(second.keys).toEqual(['c']);
    expect(second.cursor).toBeNull();
  });
});

describe('quota caps', () => {
  it('rejects a write past the byte quota with a typed error, leaving the file unchanged', async () => {
    state.env.ATMOBB_KV_MAX_STORE_BYTES = '200';
    await kvSet(INSTALL, { key: 'a', value: 'x'.repeat(50) });
    const before = await readFile(storePath(INSTALL), 'utf8');
    await expect(kvSet(INSTALL, { key: 'b', value: 'y'.repeat(500) })).rejects.toMatchObject({ code: 'store_too_large' });
    expect(await readFile(storePath(INSTALL), 'utf8')).toBe(before);
  });

  it('rejects a key over the length cap with a distinct code', async () => {
    state.env.ATMOBB_KV_MAX_KEY_LENGTH = '5';
    await expect(kvSet(INSTALL, { key: 'toolongkey', value: 1 })).rejects.toMatchObject({ code: 'key_too_long' });
    expect(await kvSet(INSTALL, { key: 'ok', value: 1 })).toBeUndefined();
  });

  it('rejects a value over the size cap with a distinct code', async () => {
    state.env.ATMOBB_KV_MAX_VALUE_BYTES = '10';
    await expect(kvSet(INSTALL, { key: 'a', value: 'way too big for ten bytes' })).rejects.toMatchObject({ code: 'value_too_large' });
  });

  it('rejects a new key over the key-count cap with a distinct code', async () => {
    state.env.ATMOBB_KV_MAX_KEYS = '2';
    await kvSet(INSTALL, { key: 'a', value: 1 });
    await kvSet(INSTALL, { key: 'b', value: 2 });
    await expect(kvSet(INSTALL, { key: 'c', value: 3 })).rejects.toMatchObject({ code: 'too_many_keys' });
    // Replacing an existing key never counted against the cap.
    await expect(kvSet(INSTALL, { key: 'a', value: 99 })).resolves.toBeUndefined();
  });

  it('rejects writes past the per-minute rate cap with a distinct code', async () => {
    state.env.ATMOBB_KV_MAX_WRITES_PER_MINUTE = '3';
    await kvSet(INSTALL, { key: 'a', value: 1 });
    await kvSet(INSTALL, { key: 'b', value: 2 });
    await kvSet(INSTALL, { key: 'c', value: 3 });
    await expect(kvSet(INSTALL, { key: 'd', value: 4 })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('every quota rejection is a KvQuotaError', async () => {
    state.env.ATMOBB_KV_MAX_KEY_LENGTH = '3';
    await expect(kvSet(INSTALL, { key: 'toolong', value: 1 })).rejects.toBeInstanceOf(KvQuotaError);
  });
});

describe('durability', () => {
  it('is created with mode 0600', async () => {
    await kvSet(INSTALL, { key: 'a', value: 1 });
    const mode = (await stat(storePath(INSTALL))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('leaves the previous file readable when a rename mid-write fails', async () => {
    await kvSet(INSTALL, { key: 'a', value: 1 });
    const before = await readFile(storePath(INSTALL), 'utf8');
    vi.mocked(rename).mockRejectedValueOnce(new Error('disk full'));
    await expect(kvSet(INSTALL, { key: 'a', value: 2 })).rejects.toThrow('disk full');
    expect(await readFile(storePath(INSTALL), 'utf8')).toBe(before);
  });
});

describe('purgeUninstalledKv', () => {
  it('keeps the store until the grace period ends, then purges it', async () => {
    await kvSet(INSTALL, { key: 'a', value: 1 });
    const justUninstalled = new Date(Date.now() - 1000).toISOString();
    await purgeUninstalledKv([{ installId: INSTALL, uninstalledAt: justUninstalled }]);
    expect(await kvGet(INSTALL, { key: 'a' })).toEqual({ value: 1 });

    const longAgo = new Date(Date.now() - KV_UNINSTALL_GRACE_MS - 1000).toISOString();
    await purgeUninstalledKv([{ installId: INSTALL, uninstalledAt: longAgo }]);
    expect(await kvGet(INSTALL, { key: 'a' })).toEqual({ value: null });
  });

  it('leaves other installs alone', async () => {
    await kvSet(INSTALL, { key: 'a', value: 1 });
    await kvSet(OTHER, { key: 'a', value: 2 });
    const longAgo = new Date(Date.now() - KV_UNINSTALL_GRACE_MS - 1000).toISOString();
    await purgeUninstalledKv([{ installId: INSTALL, uninstalledAt: longAgo }]);
    expect(await kvGet(INSTALL, { key: 'a' })).toEqual({ value: null });
    expect(await kvGet(OTHER, { key: 'a' })).toEqual({ value: 2 });
  });
});
