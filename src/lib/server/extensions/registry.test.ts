import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
import { startGitFixtures, validBundle, type FixtureRepo, type GitFixtures, type TreeSpec } from './fixtures/git-server';
import { claimCollections, listClaims } from './claims';
import type { LexiconResolver } from './manifest';
import {
  applyUpdate,
  bundleDir,
  confirmInstall,
  disableInstall,
  enableInstall,
  getInstall,
  listInstalls,
  listUpdates,
  rollbackInstall,
  stageInstall,
  stageUpdate,
  uninstall,
  type InstallReview,
} from './registry';

const GAME = 'com.example.diplomacy.game';

// Published-lexicon checks would hit real DNS; these tests have nothing published.
const nothingPublished: LexiconResolver = { authorityDid: async () => null, publishedSchema: async () => null };
const options = { lexiconResolver: nothingPublished };

let fixtures: GitFixtures;
let directory: string;
beforeAll(async () => {
  fixtures = await startGitFixtures();
});
afterAll(async () => {
  await fixtures.close();
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-registry-test-'));
  vi.stubEnv('DATA_DIR', directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

let repoCount = 0;
const newRepo = () => fixtures.repo(`registry-${++repoCount}`);

const withVersion = (version: string, extra: Record<string, unknown> = {}) => validBundle({ manifest: { version, ...extra } });

async function staged(url: string, tag: string | null): Promise<InstallReview> {
  const result = await stageInstall(url, tag, options);
  if (!result.ok) throw new Error(`expected staging to succeed: ${result.errors.map((e) => e.message).join('; ')}`);
  return result.review;
}

async function install(repo: FixtureRepo, tag = 'v0.1.0') {
  const review = await staged(repo.url, tag);
  const result = await confirmInstall(review.stagingId);
  if (!result.ok) throw new Error(`expected confirm to succeed: ${result.errors.map((e) => e.message).join('; ')}`);
  return result.install;
}

const extensionsDir = () => join(directory, 'extensions');
const exists = (path: string) => stat(path).then(() => true, () => false);

describe('stage and confirm', () => {
  it('stores an admitted bundle under a new install id and SHA and records it', async () => {
    const repo = newRepo();
    const sha = repo.tag('v0.1.0', validBundle());
    const review = await staged(repo.url, 'v0.1.0');
    expect(review).toMatchObject({ source: 'git', tag: 'v0.1.0', sha, authority: 'com.example.diplomacy', collections: [GAME] });
    expect(review.manifest.name).toBe('Diplomacy');
    expect(review.published).toMatchObject({ status: 'unpublished' });
    expect(await listInstalls()).toEqual([]);

    const result = await confirmInstall(review.stagingId);
    if (!result.ok) throw new Error('confirm failed');
    const { install: installed } = result;
    expect(installed).toMatchObject({ gitUrl: repo.url, normalizedUrl: `https://git.test/${repo.name}`, source: 'git', tag: 'v0.1.0', sha, state: 'active' });
    expect(installed.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(installed.history).toEqual([expect.objectContaining({ tag: 'v0.1.0', sha, version: '0.1.0', dataVersion: 1 })]);

    const dir = bundleDir(installed);
    expect(dir).toBe(join(extensionsDir(), installed.id, sha));
    expect((await readdir(dir, { recursive: true })).sort()).toEqual(
      ['extension.wasm', 'lexicons', 'lexicons/game.json', 'manifest.json', 'ui', 'ui/app.js', 'ui/index.html'].sort(),
    );
    expect(await getInstall(installed.id)).toEqual(installed);
    expect(await listClaims()).toMatchObject({ [GAME]: { gitUrl: `https://git.test/${repo.name}` } });
    expect(await exists(join(extensionsDir(), '.staging', review.stagingId))).toBe(false);
    expect(await confirmInstall(review.stagingId)).toMatchObject({ ok: false });
  });

  it.each<[string, TreeSpec]>([
    ['a symlink', validBundle({ dist: { 'extension.wasm': { symlink: '/etc/passwd' } } })],
    ['a ../ entry', validBundle({ dist: { '..': { 'x.js': 'x' } } })],
    ['a submodule', validBundle({ dist: { ui: { submodule: 'b'.repeat(40) } } })],
    ['a manifest admission refuses', validBundle({ manifest: { collections: ['app.bsky.feed.post'] } })],
  ])('writes nothing to disk or the registry for a release with %s', async (_label, tree) => {
    const repo = newRepo();
    repo.tag('v0.1.0', tree);
    const result = await stageInstall(repo.url, 'v0.1.0', options);
    expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ message: expect.any(String) })] });
    expect(await exists(extensionsDir())).toBe(false);
  });

  it('refuses an oversized pack and writes nothing', async () => {
    const { setFetchLimitsForTests } = await import('./fetch');
    setFetchLimitsForTests({ packBytes: 16 * 1024 });
    try {
      const repo = newRepo();
      repo.tag('v0.1.0', validBundle({ root: { 'big.bin': new Uint8Array(crypto.getRandomValues(new Uint8Array(32 * 1024))) } }));
      expect(await stageInstall(repo.url, 'v0.1.0', options)).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/download limit/) }] });
      expect(await exists(extensionsDir())).toBe(false);
    } finally {
      setFetchLimitsForTests(null);
    }
  });

  it('refuses a second install of the same repository, however the URL is written', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle());
    await install(repo);
    for (const url of [repo.url, repo.url.replace(/\.git$/, ''), `${repo.url}/`, repo.url.replace('https://git.test', 'HTTPS://GIT.TEST')]) {
      expect(await stageInstall(url, 'v0.1.0', options)).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/already installed/) }] });
    }
    expect(await listInstalls()).toHaveLength(1);
  });

  it('refuses a second confirm for the same repository staged twice', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle());
    const first = await staged(repo.url, 'v0.1.0');
    const second = await staged(repo.url, 'v0.1.0');
    expect(await confirmInstall(first.stagingId)).toMatchObject({ ok: true });
    expect(await confirmInstall(second.stagingId)).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/already installed/) }] });
  });

  it('refuses collections another repository has claimed', async () => {
    await claimCollections('https://github.com/someone/else', [GAME]);
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle());
    expect(await stageInstall(repo.url, 'v0.1.0', options)).toMatchObject({
      ok: false,
      errors: [{ message: expect.stringMatching(/github\.com\/someone\/else/) }],
    });
  });

  it('refuses a malformed staging id without touching the file system', async () => {
    expect(await confirmInstall('../../etc')).toMatchObject({ ok: false });
  });

  it('lands two concurrent confirms', async () => {
    const one = newRepo();
    one.tag('v0.1.0', validBundle());
    const two = newRepo();
    two.tag('v0.1.0', validBundle({ manifest: { collections: ['com.example.chess.game'], lexicons: ['lexicons/chess.json'] }, dist: { lexicons: { 'chess.json': JSON.stringify({ lexicon: 1, id: 'com.example.chess.game', defs: { main: { type: 'record', key: 'tid', record: { type: 'object', properties: {} } } } }) } } }));
    const [a, b] = [await staged(one.url, 'v0.1.0'), await staged(two.url, 'v0.1.0')];
    const results = await Promise.all([confirmInstall(a.stagingId), confirmInstall(b.stagingId)]);
    expect(results).toMatchObject([{ ok: true }, { ok: true }]);
    expect((await listInstalls()).map((i) => i.gitUrl).sort()).toEqual([one.url, two.url].sort());
    const [x, y] = await listInstalls();
    await Promise.all([disableInstall(x.id), disableInstall(y.id)]);
    expect((await listInstalls()).map((i) => i.state)).toEqual(['disabled', 'disabled']);
  });

  it('refuses a file:// source unless the dev flag is set, and records a content hash with it', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle());
    const project = await mkdtemp(join(tmpdir(), 'atmobb-registry-dev-'));
    try {
      const { execFileSync } = await import('node:child_process');
      execFileSync('git', ['--git-dir', repo.gitdir, 'archive', '--output', join(project, 'src.tar'), 'v0.1.0']);
      execFileSync('tar', ['-xf', 'src.tar'], { cwd: project });
      const url = `file://${project}`;
      expect(await stageInstall(url, null, options)).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/ATMOBB_EXTENSIONS_DEV/) }] });
      state.env.ATMOBB_EXTENSIONS_DEV = '1';
      const review = await staged(url, null);
      const result = await confirmInstall(review.stagingId);
      expect(result).toMatchObject({ ok: true, install: { source: 'dev', tag: null, sha: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});

describe('updates', () => {
  it('lists only tags newer than the installed one and flags a re-pointed tag', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', withVersion('0.1.0'));
    repo.tag('v0.2.0', withVersion('0.2.0'));
    const installed = await install(repo, 'v0.2.0');
    repo.tag('v0.10.0', withVersion('0.10.0'));
    repo.tag('v0.3.0-beta.1', withVersion('0.3.0-beta.1'));
    repo.tag('nightly', withVersion('nightly'));
    expect(await listUpdates(installed.id)).toEqual({ ok: true, newer: [expect.objectContaining({ name: 'v0.10.0' }), expect.objectContaining({ name: 'v0.3.0-beta.1' })], changed: [] });

    const moved = repo.tag('v0.2.0', withVersion('0.2.0', { name: 'Diplomacy (rebuilt)' }));
    expect(await listUpdates(installed.id)).toMatchObject({ ok: true, changed: [{ tag: 'v0.2.0', installedSha: installed.sha, currentSha: moved }] });
  });

  it('applies an update, keeps history, and rolls back to the previous SHA', async () => {
    const repo = newRepo();
    const first = repo.tag('v0.1.0', withVersion('0.1.0'));
    const installed = await install(repo);
    const second = repo.tag('v0.2.0', withVersion('0.2.0'));

    const update = await stageUpdate(installed.id, 'v0.2.0', options);
    if (!update.ok) throw new Error(update.errors[0].message);
    expect(update.review).toMatchObject({ installId: installed.id, sha: second });
    const migrate = vi.fn();
    const applied = await applyUpdate(installed.id, update.review.stagingId, { migrate });
    expect(applied).toMatchObject({ ok: true, install: { tag: 'v0.2.0', sha: second, manifest: { version: '0.2.0' } } });
    expect(migrate).toHaveBeenCalledWith(expect.objectContaining({ from: expect.objectContaining({ sha: first }), to: expect.objectContaining({ sha: second }) }));
    const after = (await getInstall(installed.id))!;
    expect(after.history.map((h) => h.sha)).toEqual([first, second]);
    expect(await exists(join(extensionsDir(), installed.id, first))).toBe(true);
    expect(await exists(join(extensionsDir(), installed.id, second))).toBe(true);

    const rolledBack = await rollbackInstall(installed.id, first);
    expect(rolledBack).toMatchObject({ ok: true, install: { tag: 'v0.1.0', sha: first, manifest: { version: '0.1.0' } } });
    expect((await getInstall(installed.id))!.history.map((h) => h.sha)).toEqual([first, second]);
    expect(await rollbackInstall(installed.id, 'f'.repeat(40))).toMatchObject({ ok: false });
  });

  it('keeps the previous SHA active when the migrate callback throws', async () => {
    const repo = newRepo();
    const first = repo.tag('v0.1.0', withVersion('0.1.0'));
    const installed = await install(repo);
    const second = repo.tag('v0.2.0', withVersion('0.2.0', { dataVersion: 2 }));
    const update = await stageUpdate(installed.id, 'v0.2.0', options);
    if (!update.ok) throw new Error(update.errors[0].message);

    const result = await applyUpdate(installed.id, update.review.stagingId, {
      migrate: async () => {
        throw new Error('game state v1 cannot be read');
      },
    });
    expect(result).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/game state v1 cannot be read/) }] });
    const current = (await getInstall(installed.id))!;
    expect(current).toMatchObject({ sha: first, tag: 'v0.1.0' });
    expect(current.history.map((h) => h.sha)).toEqual([first]);
    expect(await exists(join(extensionsDir(), installed.id, second))).toBe(false);
  });

  it('refuses rolling back to a release with an older data version', async () => {
    const repo = newRepo();
    const first = repo.tag('v0.1.0', withVersion('0.1.0'));
    const installed = await install(repo);
    repo.tag('v0.2.0', withVersion('0.2.0', { dataVersion: 2 }));
    const update = await stageUpdate(installed.id, 'v0.2.0', options);
    if (!update.ok) throw new Error(update.errors[0].message);
    expect(await applyUpdate(installed.id, update.review.stagingId, {})).toMatchObject({ ok: true });
    expect(await rollbackInstall(installed.id, first)).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/data version/) }] });
  });

  it('refuses staging the release that is already active', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle());
    const installed = await install(repo);
    expect(await stageUpdate(installed.id, 'v0.1.0', options)).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/already/) }] });
  });
});

describe('disable, enable, uninstall', () => {
  it('refuses to disable or uninstall with open work unless forced, and uninstall keeps claims', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle());
    const installed = await install(repo);
    const hasOpenWork = vi.fn(async () => true);

    expect(await disableInstall(installed.id, { hasOpenWork })).toMatchObject({ ok: false, errors: [{ field: 'openWork' }] });
    expect((await getInstall(installed.id))!.state).toBe('active');
    expect(await disableInstall(installed.id, { hasOpenWork, force: true })).toMatchObject({ ok: true, install: { state: 'disabled' } });
    expect(await enableInstall(installed.id)).toMatchObject({ ok: true, install: { state: 'active' } });

    expect(await uninstall(installed.id, { hasOpenWork })).toMatchObject({ ok: false, errors: [{ field: 'openWork' }] });
    expect(await getInstall(installed.id)).not.toBeNull();
    expect(await exists(join(extensionsDir(), installed.id))).toBe(true);

    expect(await uninstall(installed.id, { hasOpenWork, force: true })).toMatchObject({ ok: true });
    expect(await getInstall(installed.id)).toBeNull();
    expect(await exists(join(extensionsDir(), installed.id))).toBe(false);
    expect(await listClaims()).toMatchObject({ [GAME]: { gitUrl: `https://git.test/${repo.name}` } });
    expect(JSON.parse(await readFile(join(extensionsDir(), 'registry.json'), 'utf8'))).toEqual({ installs: [] });
  });

  it('uninstalls without asking when there is no open work', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle());
    const installed = await install(repo);
    expect(await uninstall(installed.id, { hasOpenWork: async () => false })).toMatchObject({ ok: true });
    expect(await uninstall(installed.id)).toMatchObject({ ok: false });
  });
});
