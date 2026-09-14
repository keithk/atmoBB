import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
import { startGitFixtures, validBundle, type GitFixtures, type TreeSpec } from './fixtures/git-server';
import { ReleaseError, listRemoteTags, readRelease, setFetchLimitsForTests } from './fetch';

let fixtures: GitFixtures;
let scratch: string;
beforeAll(async () => {
  // A private temp dir, so the leftover-gitdir checks only see this file's fetches.
  scratch = await mkdtemp(join(tmpdir(), 'atmobb-fetch-test-'));
  vi.stubEnv('TMPDIR', scratch);
  fixtures = await startGitFixtures();
});
afterAll(async () => {
  await fixtures.close();
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});
afterEach(() => {
  setFetchLimitsForTests(null);
  for (const key of Object.keys(state.env)) delete state.env[key];
});

let repoCount = 0;
const newRepo = () => fixtures.repo(`repo-${++repoCount}`);

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error('expected the release to be refused');
    },
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(ReleaseError);
  return (error as Error).message;
}

/** Temp dirs isomorphic-git fetches into; each must be gone once a read finishes. */
async function leftoverGitdirs() {
  return (await readdir(tmpdir())).filter((name) => name.startsWith('atmobb-extension-fetch-'));
}

describe('listRemoteTags', () => {
  it('lists lightweight and annotated tags with the commit each points at', async () => {
    const repo = newRepo();
    const one = repo.tag('v0.1.0', validBundle());
    const two = repo.tag('v0.2.0', validBundle(), { annotated: true });
    const tags = await listRemoteTags(repo.url);
    expect(tags.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'v0.1.0', sha: one },
      { name: 'v0.2.0', sha: two },
    ]);
  });

  it('refuses a URL the outbound fetcher refuses', async () => {
    await expect(listRemoteTags('https://127.0.0.1/jack/diplomacy.git')).rejects.toThrow(ReleaseError);
    await expect(listRemoteTags('http://git.test/jack/diplomacy.git')).rejects.toThrow(ReleaseError);
  });
});

describe('readRelease from git', () => {
  it('reads the bundle at a tag, keeping only allowlisted files under dist/', async () => {
    const repo = newRepo();
    const sha = repo.tag('v0.1.0', validBundle(), { annotated: true });
    const release = await readRelease(repo.url, 'v0.1.0');
    expect(release).toMatchObject({ source: 'git', tag: 'v0.1.0', sha });
    expect([...release.files.keys()].sort()).toEqual(['extension.wasm', 'lexicons/game.json', 'manifest.json', 'ui/app.js', 'ui/index.html']);
    expect(text(release.files.get('ui/index.html'))).toBe('<p>board</p>');
    expect(await leftoverGitdirs()).toEqual([]);
  });

  it('reports a tag that does not exist', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle());
    expect(await refusal(readRelease(repo.url, 'v9.9.9'))).toMatch(/v9\.9\.9/);
  });

  it('refuses a tag without the compiled module, saying what is missing', async () => {
    const repo = newRepo();
    const tree = validBundle();
    delete (tree.dist as TreeSpec)['extension.wasm'];
    repo.tag('v0.1.0', tree);
    expect(await refusal(readRelease(repo.url, 'v0.1.0'))).toMatch(/dist\/extension\.wasm/);
  });

  it('refuses a tag without dist/', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', { 'README.md': 'nothing built' });
    expect(await refusal(readRelease(repo.url, 'v0.1.0'))).toMatch(/dist\//);
  });

  it.each<[string, TreeSpec, RegExp]>([
    ['a symlink', { ui: { 'index.html': '<p>board</p>', 'secrets.js': { symlink: '/etc/passwd' } } }, /symlink/i],
    ['a submodule', { vendor: { submodule: 'a'.repeat(40) } }, /submodule/i],
    ['a ../ entry', { '..': { 'escape.js': 'x' } }, /\.\./],
    ['a .git segment', { ui: { 'index.html': '<p>board</p>', '.GIT': { config: 'x' } } }, /\.git/i],
    ['a backslash', { 'ui\\evil.js': 'x' }, /\\/],
    ['a case-insensitive collision', { ui: { 'index.html': '<p>board</p>', 'App.js': 'a', 'app.js': 'b' } }, /collide/i],
  ])('refuses a release containing %s', async (_label, dist, message) => {
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle({ dist }));
    expect(await refusal(readRelease(repo.url, 'v0.1.0'))).toMatch(message);
    expect(await leftoverGitdirs()).toEqual([]);
  });

  it('refuses a symlinked dist/', async () => {
    const repo = newRepo();
    repo.tag('v0.1.0', { dist: { symlink: 'build' } });
    expect(await refusal(readRelease(repo.url, 'v0.1.0'))).toMatch(/symlink/i);
  });

  it('refuses a pack bigger than the download cap', async () => {
    setFetchLimitsForTests({ packBytes: 64 * 1024 });
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle({ root: { 'big.bin': randomBytes(65 * 1024) } }));
    expect(await refusal(readRelease(repo.url, 'v0.1.0'))).toMatch(/download limit/i);
    expect(await leftoverGitdirs()).toEqual([]);
  });

  it('refuses an object that inflates past the file cap before unpacking it', async () => {
    setFetchLimitsForTests({ fileBytes: 4096 });
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle({ root: { 'bomb.txt': 'a'.repeat(1024 * 1024) } }));
    expect(await refusal(readRelease(repo.url, 'v0.1.0'))).toMatch(/file limit/i);
  });

  it('refuses a tree with more entries than the cap', async () => {
    setFetchLimitsForTests({ treeEntries: 10 });
    const repo = newRepo();
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${i}.js`, `// ${i}`]));
    repo.tag('v0.1.0', validBundle({ dist: { ui: { 'index.html': '<p>board</p>', ...many } } }));
    expect(await refusal(readRelease(repo.url, 'v0.1.0'))).toMatch(/entries/i);
  });

  it('refuses a bundle bigger than the bundle cap', async () => {
    setFetchLimitsForTests({ bundleBytes: 1024 });
    const repo = newRepo();
    repo.tag('v0.1.0', validBundle({ dist: { ui: { 'index.html': '<p>board</p>', 'app.js': `// ${'x'.repeat(2048)}` } } }));
    expect(await refusal(readRelease(repo.url, 'v0.1.0'))).toMatch(/bundle limit/i);
  });

  it('refuses a tag name that is not a plain tag', async () => {
    const repo = newRepo();
    for (const tag of ['', '../main', 'refs/heads/main', '-v1', 'v1 2']) {
      await expect(readRelease(repo.url, tag)).rejects.toThrow(ReleaseError);
    }
  });
});

describe('readRelease from a local directory', () => {
  let project: string;
  afterEach(async () => {
    if (project) await rm(project, { recursive: true, force: true });
  });

  async function writeProject(spec: TreeSpec, dir: string) {
    for (const [name, value] of Object.entries(spec)) {
      const path = join(dir, name);
      if (typeof value === 'string' || value instanceof Uint8Array) await writeFile(path, value);
      else if ('symlink' in value) await symlink(value.symlink as string, path);
      else {
        await mkdir(path, { recursive: true });
        await writeProject(value as TreeSpec, path);
      }
    }
  }

  async function makeProject(spec: TreeSpec = validBundle()) {
    project = await mkdtemp(join(tmpdir(), 'atmobb-dev-extension-'));
    await writeProject(spec, project);
    return pathToFileURL(project).toString();
  }

  it('is refused unless the dev flag is set', async () => {
    const url = await makeProject();
    expect(await refusal(readRelease(url, null))).toMatch(/ATMOBB_EXTENSIONS_DEV/);
    state.env.ATMOBB_EXTENSIONS_DEV = 'true';
    await expect(readRelease(url, null)).rejects.toThrow(ReleaseError);
  });

  it('reads dist/ with the same allowlist and hashes its content', async () => {
    state.env.ATMOBB_EXTENSIONS_DEV = '1';
    const url = await makeProject();
    const first = await readRelease(url, null);
    expect(first).toMatchObject({ source: 'dev', tag: null });
    expect(first.sha).toMatch(/^[0-9a-f]{64}$/);
    expect([...first.files.keys()].sort()).toEqual(['extension.wasm', 'lexicons/game.json', 'manifest.json', 'ui/app.js', 'ui/index.html']);

    expect((await readRelease(url, null)).sha).toBe(first.sha);
    await writeFile(join(project, 'dist', 'build.log'), 'ignored files do not count');
    expect((await readRelease(url, null)).sha).toBe(first.sha);
    await writeFile(join(project, 'dist', 'ui', 'app.js'), 'export const changed = true');
    expect((await readRelease(url, null)).sha).not.toBe(first.sha);
  });

  it('refuses a symlink inside dist/', async () => {
    state.env.ATMOBB_EXTENSIONS_DEV = '1';
    const url = await makeProject(validBundle({ dist: { ui: { 'index.html': '<p>board</p>', 'passwd.js': { symlink: '/etc/passwd' } } } }));
    expect(await refusal(readRelease(url, null))).toMatch(/symlink/i);
  });
});

describe('pack vetting', () => {
  it('reads a pack whose objects are stored as deltas', async () => {
    const repo = newRepo();
    const base = Array.from({ length: 2000 }, (_, i) => `export const line${i} = ${i};`).join('\n');
    repo.tag('v0.1.0', validBundle({ dist: { ui: { 'index.html': '<p>board</p>', 'app.js': base, 'app2.js': `${base}\n// changed` } } }));
    const release = await readRelease(repo.url, 'v0.1.0');
    expect(text(release.files.get('ui/app2.js'))).toBe(`${base}\n// changed`);
  });
});
