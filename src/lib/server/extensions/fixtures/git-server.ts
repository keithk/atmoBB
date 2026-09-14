import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetOutboundForTests, setRequestFnForTests, setResolverForTests } from '../outbound';

// Test-only git fixtures. Repositories are built with the git binary straight
// from objects (hash-object, mktree, commit-tree), so a tree can hold entries
// a normal checkout would refuse. They're served over smart HTTP by
// `git http-backend`, and the outbound fetcher's test seams route
// https://git.test/<repo> to that local server, so the code under test takes
// the same outboundFetch path it takes in production.

export const GIT_TEST_HOST = 'git.test';

/** A file's contents, or a special entry. */
export type TreeSpec = { [name: string]: string | Uint8Array | TreeSpec | { symlink: string } | { submodule: string } };

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
};

const git = (gitdir: string, args: string[], input?: string | Uint8Array) =>
  execFileSync('git', ['--git-dir', gitdir, ...args], { env: gitEnv, input, maxBuffer: 256 * 1024 * 1024 }).toString().trim();

const isSpecial = (value: unknown): value is { symlink: string } | { submodule: string } =>
  typeof value === 'object' && value !== null && ('symlink' in value || 'submodule' in value);

function writeTree(gitdir: string, spec: TreeSpec): string {
  const lines = Object.entries(spec).map(([name, value]) => {
    if (typeof value === 'string' || value instanceof Uint8Array) {
      return `100644 blob ${git(gitdir, ['hash-object', '-w', '--stdin'], value)}\t${name}`;
    }
    if (isSpecial(value)) {
      if ('symlink' in value) return `120000 blob ${git(gitdir, ['hash-object', '-w', '--stdin'], value.symlink)}\t${name}`;
      return `160000 commit ${value.submodule}\t${name}`;
    }
    return `040000 tree ${writeTree(gitdir, value)}\t${name}`;
  });
  return git(gitdir, ['mktree', '--missing'], lines.join('\n') + (lines.length ? '\n' : ''));
}

export class FixtureRepo {
  readonly gitdir: string;

  constructor(
    readonly root: string,
    readonly name: string,
  ) {
    this.gitdir = join(root, `${name}.git`);
    execFileSync('git', ['init', '--bare', '-q', this.gitdir], { env: gitEnv });
  }

  get url() {
    return `https://${GIT_TEST_HOST}/${this.name}.git`;
  }

  /** Commit `tree` and point `tag` at it (replacing any existing tag), returning the commit SHA. */
  tag(tag: string, tree: TreeSpec, { annotated = false } = {}): string {
    const treeOid = writeTree(this.gitdir, tree);
    const commit = git(this.gitdir, ['commit-tree', treeOid, '-m', `release ${tag}`]);
    if (annotated) git(this.gitdir, ['tag', '-f', '-a', '-m', tag, tag, commit]);
    else git(this.gitdir, ['tag', '-f', tag, commit]);
    // A default branch, as every hosted repository has; the git client expects HEAD to resolve.
    git(this.gitdir, ['update-ref', 'refs/heads/main', commit]);
    git(this.gitdir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    return commit;
  }
}

/** Run `git http-backend` for one request against every repository under `root`. */
function serveGit(root: string, server: Server) {
  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const child = spawn('git', ['http-backend'], {
      env: {
        ...gitEnv,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method ?? 'GET',
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        REMOTE_ADDR: '127.0.0.1',
        GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
      },
    });
    req.pipe(child.stdin);
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('close', () => {
      const output = Buffer.concat(chunks);
      const split = output.indexOf('\r\n\r\n');
      const headerEnd = split === -1 ? output.indexOf('\n\n') : split;
      const separator = split === -1 ? 2 : 4;
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of output.subarray(0, headerEnd).toString().split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (key === 'status') status = Number(value.split(' ')[0]);
        else headers[key] = value;
      }
      res.writeHead(status, headers);
      res.end(output.subarray(headerEnd + separator));
    });
  });
}

export interface GitFixtures {
  root: string;
  repo(name: string): FixtureRepo;
  close(): Promise<void>;
}

/** A directory of fixture repositories served at https://git.test/<name>.git through the outbound fetcher. */
export async function startGitFixtures(): Promise<GitFixtures> {
  const root = mkdtempSync(join(tmpdir(), 'atmobb-git-fixtures-'));
  const server = createServer();
  serveGit(root, server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  // TEST-NET-3 passes the address blocklist; the request itself goes to the local server.
  setResolverForTests(async (hostname) => {
    if (hostname === GIT_TEST_HOST) return [{ address: '203.0.113.10', family: 4 }];
    throw new Error(`unexpected DNS lookup for ${hostname}`);
  });
  setRequestFnForTests(((options, callback) => httpRequest({ ...options, host: '127.0.0.1', port }, callback)) as Parameters<
    typeof setRequestFnForTests
  >[0]);

  return {
    root,
    repo: (name) => new FixtureRepo(root, name),
    async close() {
      resetOutboundForTests();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** A bundle tree that admits: one record collection, a lexicon, a UI, and a stand-in module. */
export function validBundle(overrides: { manifest?: Record<string, unknown>; dist?: TreeSpec; root?: TreeSpec } = {}): TreeSpec {
  const manifest = {
    id: 'diplomacy',
    name: 'Diplomacy',
    version: '0.1.0',
    hostApi: '1.0',
    dataVersion: 1,
    collections: ['com.example.diplomacy.game'],
    capabilities: ['kv', 'records'],
    ui: { entry: 'ui/index.html' },
    lexicons: ['lexicons/game.json'],
    ...overrides.manifest,
  };
  const lexicon = {
    lexicon: 1,
    id: 'com.example.diplomacy.game',
    defs: { main: { type: 'record', key: 'tid', record: { type: 'object', properties: { thread: { type: 'string', format: 'at-uri' } } } } },
  };
  return {
    'README.md': '# Diplomacy',
    ...overrides.root,
    dist: {
      'manifest.json': JSON.stringify(manifest),
      'extension.wasm': new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
      lexicons: { 'game.json': JSON.stringify(lexicon) },
      ui: { 'index.html': '<p>board</p>', 'app.js': 'export {}', 'notes.txt': 'not shipped' },
      'build.log': 'not shipped',
      ...overrides.dist,
    },
  };
}
