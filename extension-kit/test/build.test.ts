import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRelease } from '../../src/lib/server/extensions/fetch';
import { reservedReason } from '../../src/lib/server/extensions/manifest';
import { extensionRuntime } from '../../src/lib/server/extensions/runtime';
import { build } from '../src/cli/build';
import { scaffold } from '../src/cli/new';
import { ensureToolchain, type CompilerPins } from '../src/cli/toolchain';
import { stubHost } from './stub-host';

const scratch: string[] = [];
const tempDir = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
afterAll(() => Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true }))));

const offline = () => Promise.reject(new TypeError('fetch failed'));

const viewer = { did: 'did:plc:member', standing: 'member', staff: false, banned: false };
const THREAD = 'at://did:plc:forum/app.atmobb.discussion.thread/3kthread';
const OTHER_THREAD = 'at://did:plc:member/app.atmobb.discussion.thread/3kother';

describe('new + build', () => {
  let project: string;
  beforeEach(async () => {
    project = join(await tempDir('kit-template-'), 'my-counter');
    await scaffold(project);
  });

  it('scaffolds a project named after its directory', async () => {
    const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-counter');
    expect(pkg.devDependencies['atmobb-extension-kit']).toMatch(/^file:/);
    expect(await readdir(project)).toEqual(expect.arrayContaining(['.gitignore', 'manifest.json', 'src', 'lexicons', 'ui', 'tsconfig.json']));
  });

  it('builds the template into a release the atmoBB host reads and runs', async () => {
    const result = await build({ projectDir: project });

    process.env.ATMOBB_EXTENSIONS_DEV = '1';
    const release = await readRelease(pathToFileURL(project).href, null).finally(() => delete process.env.ATMOBB_EXTENSIONS_DEV);
    expect([...release.files.keys()].sort()).toEqual([
      'extension.wasm',
      'lexicons/com.example.counter.tally.json',
      'manifest.json',
      'ui/index.html',
      'ui/panel.css',
      'ui/panel.js',
    ]);
    expect(result.distDir).toBe(join(project, 'dist'));

    const tallies = new Map<string, Record<string, unknown>>();
    const host = stubHost({
      record_create: (p) => {
        const rkey = `tally${tallies.size + 1}`;
        tallies.set(rkey, p.record as Record<string, unknown>);
        return { ok: true, value: { uri: `at://did:plc:forum/${p.collection}/${rkey}`, cid: 'bafytally' } };
      },
      record_put: (p) => (tallies.set(p.rkey as string, p.record as Record<string, unknown>), { ok: true, value: { uri: `at://did:plc:forum/${p.collection}/${p.rkey}`, cid: 'bafytally' } }),
      timer_set: () => ({ ok: true, value: null }),
    });
    const runtime = extensionRuntime(async () => ({ wasm: release.files.get('extension.wasm')!, functions: host.functions }));
    const act = async (thread: string | null, action: string, input: unknown = {}) =>
      JSON.parse((await runtime.call('counter', 'action', JSON.stringify({ viewer, thread: thread && { uri: thread }, action, input })))!);
    const attach = async (thread: string, input: unknown) =>
      runtime.call('counter', 'attach', JSON.stringify({ viewer: { ...viewer, staff: true }, thread: { uri: thread }, input }));
    try {
      expect(JSON.parse((await attach(THREAD, { start: 5 }))!)).toEqual({ count: 5 });
      expect(JSON.parse((await attach(OTHER_THREAD, {}))!)).toEqual({ count: 0 });
      await expect(attach(`${THREAD}x`, { start: -1 })).rejects.toThrow();

      expect(await act(THREAD, 'increment')).toEqual({ count: 6 });
      expect(await act(THREAD, 'increment')).toEqual({ count: 7 });
      expect(await act(OTHER_THREAD, 'increment')).toEqual({ count: 1 });
      expect(await act(THREAD, 'show')).toEqual({ count: 7 });
      expect(await act(OTHER_THREAD, 'show')).toEqual({ count: 1 });
      await expect(runtime.call('counter', 'action', JSON.stringify({ viewer, thread: null, action: 'show', input: {} }))).rejects.toThrow();
      await expect(act(`${THREAD}x`, 'show')).rejects.toThrow();

      expect(tallies.get('tally1')).toMatchObject({ thread: THREAD, count: 7 });
      expect(tallies.get('tally2')).toMatchObject({ thread: OTHER_THREAD, count: 1 });

      const timer = host.calls.find((c) => c.name === 'timer_set')!.payload;
      expect(timer).toMatchObject({ payload: { thread: THREAD } });
      await runtime.call('counter', 'timer', JSON.stringify(timer));
      expect(await act(THREAD, 'show')).toEqual({ count: 0 });
      expect(await act(OTHER_THREAD, 'show')).toEqual({ count: 1 });
    } finally {
      await runtime.close();
    }
  });

  it('fails with the admission message when the manifest declares a forum collection', async () => {
    const path = join(project, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.collections.push('app.atmobb.forum.moderator');
    await writeFile(path, JSON.stringify(manifest, null, 2));

    // An offline toolchain: the manifest has to be refused before any download.
    const failure = build({ projectDir: project, toolchain: { cacheDir: await tempDir('kit-cache-'), fetch: offline } });
    await expect(failure).rejects.toThrow(reservedReason('app.atmobb.forum.moderator')!);
    await expect(stat(join(project, 'dist'))).rejects.toThrow();
  });

  it('fails with a readable error when the compiler can’t be downloaded', async () => {
    const failure = build({ projectDir: project, toolchain: { cacheDir: await tempDir('kit-cache-'), fetch: offline } });
    await expect(failure).rejects.toThrow(/Couldn't download extism-js v1\.7\.0 from https:\/\/github\.com\/.*: fetch failed/);
    await expect(stat(join(project, 'dist'))).rejects.toThrow();
  });
});

describe('toolchain download', () => {
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const fakeCompiler = gzipSync(Buffer.from('#!/bin/sh\n'));
  const pins = (binaryenUrl: string): CompilerPins => ({
    extismJs: { release: 'v1.7.0', platforms: { 'test-target': { url: 'https://example.test/extism-js.gz', sha256: sha256(fakeCompiler) } } },
    binaryen: { release: 'version_132', platforms: { 'test-target': { url: binaryenUrl, sha256: '0'.repeat(64) } } },
  });
  const serveCompiler = (url: string) =>
    url === 'https://example.test/extism-js.gz' ? Promise.resolve(new Response(fakeCompiler)) : offline();

  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await tempDir('kit-cache-');
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('names binaryen when it is the download that fails', async () => {
    const failure = ensureToolchain({ cacheDir, target: 'test-target', pins: pins('https://example.test/binaryen.tar.gz'), fetch: serveCompiler });
    await expect(failure).rejects.toThrow(/Couldn't download binaryen version_132 from https:\/\/example\.test\/binaryen\.tar\.gz: fetch failed/);
  });

  it('reports an HTTP error status', async () => {
    const failure = ensureToolchain({ cacheDir, target: 'test-target', pins: pins('x'), fetch: async () => new Response('gone', { status: 404 }) });
    await expect(failure).rejects.toThrow(/Couldn't download extism-js v1\.7\.0 from .*: HTTP 404/);
  });

  it('refuses a download whose checksum does not match the pin', async () => {
    const failure = ensureToolchain({
      cacheDir,
      target: 'test-target',
      pins: pins('https://example.test/binaryen.tar.gz'),
      fetch: async (url) => new Response(url.endsWith('.gz') && !url.includes('binaryen') ? fakeCompiler : 'not binaryen'),
    });
    await expect(failure).rejects.toThrow(/binaryen version_132 .* sha256 .* expected 0{64}/);
  });

  it('refuses a platform with no pinned build', async () => {
    await expect(ensureToolchain({ cacheDir, target: 'plan9-mips', fetch: offline })).rejects.toThrow(
      /no extism-js build for plan9-mips; it supports darwin-arm64, darwin-x64, linux-x64, linux-arm64/,
    );
  });
});
