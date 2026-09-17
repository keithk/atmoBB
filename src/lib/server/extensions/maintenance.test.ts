import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));

import { KV_UNINSTALL_GRACE_MS, kvGet, kvSet } from './kv';
import { listUninstalled } from './registry';
import { scheduleTimer } from './scheduler';
import { purgeUninstalled } from './maintenance';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-maintenance-test-'));
  vi.stubEnv('DATA_DIR', directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('purgeUninstalled', () => {
  it('purges k/v and timers only for installs uninstalled past the grace period, and forgets them', async () => {
    const now = Date.now();
    const at = new Date(now + 120_000).toISOString();
    for (const id of ['old', 'recent']) {
      await kvSet(id, { key: 'game', value: id });
      await scheduleTimer(id, { name: 'deadline', at });
    }
    await mkdir(join(directory, 'extensions'), { recursive: true });
    await writeFile(
      join(directory, 'extensions', 'registry.json'),
      JSON.stringify({
        installs: [],
        uninstalled: [
          { installId: 'old', uninstalledAt: new Date(now - KV_UNINSTALL_GRACE_MS - 1_000).toISOString() },
          { installId: 'recent', uninstalledAt: new Date(now - 1_000).toISOString() },
        ],
      }),
    );

    expect(await purgeUninstalled(now)).toEqual(['old']);
    expect(await kvGet('old', { key: 'game' })).toEqual({ value: null });
    expect(await kvGet('recent', { key: 'game' })).toEqual({ value: 'recent' });
    expect(await listUninstalled()).toEqual([expect.objectContaining({ installId: 'recent' })]);
    const timers = JSON.parse(await readFile(join(directory, 'extensions', 'timers.json'), 'utf8')).timers;
    expect(timers.map((timer: { installId: string }) => timer.installId)).toEqual(['recent']);
  });
});
