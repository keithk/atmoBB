import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimCollections, claimConflicts, listClaims, newInstallId, normalizeGitUrl, releaseClaim } from './claims';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-claims-test-'));
  vi.stubEnv('DATA_DIR', directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

const GAME = 'com.example.diplomacy.game';
const ORDER = 'com.example.diplomacy.order';

describe('normalizeGitUrl', () => {
  it('treats trailing slashes, .git, case in scheme and host, and user info as the same repository', () => {
    const key = normalizeGitUrl('https://github.com/jack/diplomacy');
    for (const variant of [
      'https://github.com/jack/diplomacy.git',
      'https://github.com/jack/diplomacy/',
      'https://github.com/jack/diplomacy.git/',
      'HTTPS://GitHub.com/jack/diplomacy',
      'https://token:secret@github.com/jack/diplomacy.git',
      'https://github.com:443/jack/diplomacy',
      'https://github.com/jack/diplomacy#main',
    ]) {
      expect(normalizeGitUrl(variant)).toBe(key);
    }
    expect(key).toBe('https://github.com/jack/diplomacy');
    expect(normalizeGitUrl('https://github.com/Jack/diplomacy')).not.toBe(key);
  });

  it('throws on something that is not a URL', () => {
    expect(() => normalizeGitUrl('git@github.com:jack/diplomacy.git')).toThrow();
  });
});

describe('collection claims', () => {
  it('claims collections for a git URL and lets the same repository re-claim them', async () => {
    expect(await claimCollections('https://github.com/jack/diplomacy', [GAME, ORDER])).toEqual({ ok: true });
    expect(await claimCollections('https://github.com/jack/diplomacy.git/', [GAME])).toEqual({ ok: true });
    expect(await listClaims()).toEqual({
      [GAME]: { gitUrl: 'https://github.com/jack/diplomacy', claimedAt: expect.any(String) },
      [ORDER]: { gitUrl: 'https://github.com/jack/diplomacy', claimedAt: expect.any(String) },
    });
  });

  it('refuses a different repository while the claim is held, even with no install left, until an admin releases it', async () => {
    await claimCollections('https://github.com/jack/diplomacy', [GAME]);
    // Uninstalling never touches claims, so the store alone is what a later install meets.
    const conflict = [{ collection: GAME, heldBy: 'https://github.com/jack/diplomacy' }];
    expect(await claimConflicts('https://github.com/mallory/diplomacy', [GAME, ORDER])).toEqual(conflict);
    expect(await claimCollections('https://github.com/mallory/diplomacy', [ORDER, GAME])).toEqual({ ok: false, conflicts: conflict });
    // A refused claim takes nothing, not even the free collection.
    expect(Object.keys(await listClaims())).toEqual([GAME]);

    expect(await releaseClaim(GAME)).toBe(true);
    expect(await releaseClaim(GAME)).toBe(false);
    expect(await claimCollections('https://github.com/mallory/diplomacy', [ORDER, GAME])).toEqual({ ok: true });
    expect((await listClaims())[GAME].gitUrl).toBe('https://github.com/mallory/diplomacy');
  });

  it('persists claims as one JSON file under DATA_DIR', async () => {
    await claimCollections('https://github.com/jack/diplomacy', [GAME]);
    const stored = JSON.parse(await readFile(join(directory, 'extensions', 'claims.json'), 'utf8'));
    expect(stored.claims[GAME].gitUrl).toBe('https://github.com/jack/diplomacy');
    expect(await readdir(join(directory, 'extensions'))).toEqual(['claims.json']);
  });

  it('serializes concurrent claims so only one repository wins a collection', async () => {
    const results = await Promise.all([
      claimCollections('https://github.com/jack/diplomacy', [GAME]),
      claimCollections('https://github.com/mallory/diplomacy', [GAME]),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
  });
});

describe('newInstallId', () => {
  it('is random, URL-safe, and a single path segment', () => {
    const ids = new Set(Array.from({ length: 50 }, newInstallId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('takes nothing from the manifest, so a hostile manifest id cannot steer paths', () => {
    expect(newInstallId.length).toBe(0);
    expect(newInstallId()).not.toContain('oauth-sessions');
  });
});
