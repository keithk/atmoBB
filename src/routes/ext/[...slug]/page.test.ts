import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The standalone extension page over the real registry on disk. The seams are
// the environment and the extensions lock.

const APP = 'https://forum.test';
const REPO = 'https://git.example/jack/diplomacy';

const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, lockHeld: true }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/extensions/lock', () => ({ extensionsLockHeld: () => state.lockHeld }));

import { load } from './+page.server';

let directory: string;

async function writeInstall(id: string, options: { state?: string; ui?: boolean } = {}) {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const install = {
    id,
    sha: 'abc',
    normalizedUrl: REPO,
    state: options.state ?? 'active',
    manifest: { name: 'Diplomacy', collections: [], ...(options.ui === false ? {} : { ui: { entry: 'ui/index.html' } }) },
  };
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify({ installs: [install] }));
}

const visit = (path: string, did: string | null = null) =>
  load({ url: new URL(`${APP}${path}`), locals: { user: did ? { did, handle: 'someone.test' } : null } } as never) as Promise<Record<string, unknown>>;

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error: { status?: number }) => error.status,
  );

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-ext-page-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.lockHeld = true;
  await writeInstall('AAAAAAAAAAAAAAAAAAAAAA');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

describe('/ext/[...slug]', () => {
  it('shows the panel for the repository’s install, with the page path inside it', async () => {
    expect(await visit('/ext/git.example/jack/diplomacy/-/games/spring-1901', 'did:plc:member')).toMatchObject({
      panel: { installId: 'AAAAAAAAAAAAAAAAAAAAAA', name: 'Diplomacy', entry: 'index.html', pageBase: '/ext/git.example/jack/diplomacy' },
      path: 'games/spring-1901',
      signedIn: true,
    });
    expect(await visit('/ext/git.example/jack/diplomacy')).toMatchObject({ path: '', signedIn: false });
  });

  it('keeps the same address working after a reinstall gives the extension a new install id', async () => {
    await writeInstall('BBBBBBBBBBBBBBBBBBBBBB');
    expect(await visit('/ext/git.example/jack/diplomacy/-/games/spring-1901')).toMatchObject({ panel: { installId: 'BBBBBBBBBBBBBBBBBBBBBB' } });
  });

  it('answers 404 for an unknown repository, a malformed address, and an install that is disabled or has no UI', async () => {
    expect(await status(visit('/ext/git.example/jack/chess'))).toBe(404);
    expect(await status(visit('/ext/-/x'))).toBe(404);
    await writeInstall('AAAAAAAAAAAAAAAAAAAAAA', { state: 'disabled' });
    expect(await status(visit('/ext/git.example/jack/diplomacy'))).toBe(404);
    await writeInstall('AAAAAAAAAAAAAAAAAAAAAA', { ui: false });
    expect(await status(visit('/ext/git.example/jack/diplomacy'))).toBe(404);
  });

  it('refuses cleanly while extensions are off or this server lacks the lock', async () => {
    state.env.ATMOBB_EXTENSIONS = 'off';
    expect(await status(visit('/ext/git.example/jack/diplomacy'))).toBe(503);
    delete state.env.ATMOBB_EXTENSIONS;
    state.lockHeld = false;
    expect(await status(visit('/ext/git.example/jack/diplomacy'))).toBe(503);
  });
});
