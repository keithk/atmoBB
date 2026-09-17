import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The frame route over a real registry and bundle on disk. The seams are the
// environment and the extensions lock.

const APP = 'https://forum.test';
const INSTALL = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'BBBBBBBBBBBBBBBBBBBBBB';
const SHA = 'abc123';

const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, lockHeld: true }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/extensions/lock', () => ({ extensionsLockHeld: () => state.lockHeld }));

import { isFramePath } from '$lib/server/extensions/frame';
import { GET, trailingSlash } from './+server';
import { resetRegistryCacheForTests } from '$lib/server/extensions/registry';

let directory: string;

async function writeBundle(id: string, files: Record<string, string>, installState = 'active', ui: { entry: string } | null = { entry: 'ui/index.html' }) {
  const dir = join(directory, 'extensions', id, SHA);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return { id, sha: SHA, normalizedUrl: `https://git.example/jack/${id}`, state: installState, manifest: { name: 'Diplomacy', collections: [], ui: ui ?? undefined } };
}

async function writeRegistry(...installs: unknown[]) {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify({ installs }));
  resetRegistryCacheForTests();
}

interface FrameRequest {
  path: string;
  dest?: string | null;
  install?: string;
  headers?: Record<string, string>;
}

async function frame({ path, dest = 'iframe', install = INSTALL, headers = {} }: FrameRequest) {
  const request = new Request(`${APP}/x/${install}/frame/${path}`, { headers });
  if (dest !== null) request.headers.set('sec-fetch-dest', dest);
  const cookies = { get: vi.fn(), getAll: vi.fn(), set: vi.fn(), delete: vi.fn(), serialize: vi.fn() };
  const event = { request, params: { install, path }, url: new URL(request.url), cookies, locals: { user: null } };
  const response = await GET(event as never);
  expect(cookies.get).not.toHaveBeenCalled();
  expect(cookies.set).not.toHaveBeenCalled();
  return response;
}

const CSP =
  `sandbox allow-scripts; default-src 'none'; script-src ${APP}/x/${INSTALL}/frame/; style-src ${APP}/x/${INSTALL}/frame/ ${APP}/x/fonts/fonts.css; ` +
  `img-src ${APP}/x/${INSTALL}/frame/ data:; font-src ${APP}/x/${INSTALL}/frame/ ${APP}/x/fonts/; connect-src 'none'; frame-src 'none'; worker-src 'none'; ` +
  `form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'`;

function expectFrameHeaders(response: Response) {
  expect(response.headers.get('content-security-policy')).toBe(CSP);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('permissions-policy')).toMatch(/camera=\(\)/);
  expect(response.headers.get('permissions-policy')).toMatch(/geolocation=\(\)/);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('cross-origin-resource-policy')).toMatch(/^(same-origin|cross-origin)$/);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('location')).toBeNull();
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-frame-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.env.ATMOBB_APP_URL = APP;
  state.lockHeld = true;
  const files = {
    'ui/index.html': '<!doctype html><script src="panel.js"></script>',
    'ui/other.html': '<!doctype html>',
    'ui/panel.js': 'parent.postMessage({}, "*")',
    'ui/panel.css': 'body{}',
    'ui/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'ui/map.png': 'png',
    'ui/map.webp': 'webp',
    'ui/font.woff2': 'woff2',
    'ui/data.json': '{}',
    'ui/notes.txt': 'text',
    'ui/page.htm': '<script>alert(1)</script>',
    'ui/sub/nested.js': 'nested',
    'manifest.json': '{}',
    'extension.wasm': 'wasm',
    'secret.js': 'outside the ui directory',
  };
  await writeRegistry(await writeBundle(INSTALL, files), await writeBundle(OTHER, files));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

describe('GET /x/[install]/frame/[...path]', () => {
  it('never redirects a trailing slash', () => {
    expect(trailingSlash).toBe('ignore');
  });

  it('recognizes frame paths and the fonts frames load, so the session hook can skip them', () => {
    for (const path of [`/x/${INSTALL}/frame`, `/x/${INSTALL}/frame/`, `/x/${INSTALL}/frame/index.html`, `/x/${INSTALL}/%66rame/panel.js`, '/x/fonts/fonts.css', '/x/%66onts/fonts.css']) expect(isFramePath(path), path).toBe(true);
    for (const path of [`/x/${INSTALL}/action`, `/x/${INSTALL}/framework`, `/t/did:plc:x/frame`, '/x/frame', '/x/fontsy/fonts.css', '/fonts/fonts.css']) expect(isFramePath(path), path).toBe(false);
  });

  it('serves the UI entry to an iframe with the full header set', async () => {
    const response = await frame({ path: 'index.html' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expectFrameHeaders(response);
    expect(await response.text()).toContain('panel.js');
  });

  it('refuses the entry to any destination but an iframe, and when the destination is missing', async () => {
    for (const dest of ['document', 'script', 'embed', 'object', 'worker', 'sharedworker', 'serviceworker', 'frame', 'empty', null]) {
      const response = await frame({ path: 'index.html', dest });
      expect(response.status, String(dest)).toBe(403);
      expectFrameHeaders(response);
    }
  });

  it('serves each asset type only to its own destination, cross-origin readable', async () => {
    for (const [path, dest, type] of [
      ['panel.js', 'script', 'text/javascript; charset=utf-8'],
      ['sub/nested.js', 'script', 'text/javascript; charset=utf-8'],
      ['panel.css', 'style', 'text/css; charset=utf-8'],
      ['icon.svg', 'image', 'image/svg+xml'],
      ['map.png', 'image', 'image/png'],
      ['map.webp', 'image', 'image/webp'],
      ['font.woff2', 'font', 'font/woff2'],
      ['data.json', 'json', 'application/json'],
    ]) {
      const response = await frame({ path, dest });
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toBe(type);
      expect(response.headers.get('cross-origin-resource-policy'), path).toBe('cross-origin');
      expectFrameHeaders(response);
    }
    for (const [path, dest] of [
      ['panel.js', 'document'],
      ['panel.js', 'iframe'],
      ['panel.js', 'worker'],
      ['panel.js', null],
      ['panel.css', 'script'],
      ['icon.svg', 'iframe'],
      ['icon.svg', 'document'],
      ['map.png', 'script'],
      ['font.woff2', 'style'],
    ] as [string, string | null][]) {
      const response = await frame({ path, dest });
      expect(response.status, `${path} as ${dest}`).toBe(403);
      expectFrameHeaders(response);
    }
  });

  it('refuses a service worker script', async () => {
    const response = await frame({ path: 'panel.js', dest: 'script', headers: { 'service-worker': 'script' } });
    expect(response.status).toBe(403);
    expectFrameHeaders(response);
  });

  it('answers 404 with the full header set for files outside the UI directory, escapes, and types off the allowlist', async () => {
    for (const [path, dest] of [
      ['missing.js', 'script'],
      ['other.html', 'iframe'],
      ['notes.txt', 'iframe'],
      ['page.htm', 'iframe'],
      ['../secret.js', 'script'],
      ['..%2Fsecret.js', 'script'],
      ['sub/../../secret.js', 'script'],
      ['./panel.js', 'script'],
      ['sub//nested.js', 'script'],
      ['..\\secret.js', 'script'],
      ['../manifest.json', 'json'],
      ['../extension.wasm', 'script'],
      ['extension.wasm', 'script'],
      ['sub', 'script'],
      ['', 'iframe'],
    ]) {
      const response = await frame({ path, dest });
      expect(response.status, path).toBe(404);
      expectFrameHeaders(response);
    }
  });

  it('answers 404 for an install that is missing, disabled, or has no UI, with a policy that allows no scripts for a malformed id', async () => {
    await writeRegistry(await writeBundle(INSTALL, { 'ui/index.html': 'x' }, 'disabled'), await writeBundle(OTHER, { 'ui/index.html': 'x' }, 'active', null));
    const disabled = await frame({ path: 'index.html' });
    expect(disabled.status).toBe(404);
    expectFrameHeaders(disabled);
    expect((await frame({ path: 'index.html', install: OTHER })).status).toBe(404);
    expect((await frame({ path: 'index.html', install: 'CCCCCCCCCCCCCCCCCCCCCC' })).status).toBe(404);

    const malformed = await frame({ path: 'index.html', install: "x; script-src 'unsafe-inline'" });
    expect(malformed.status).toBe(404);
    expect(malformed.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(malformed.headers.get('content-security-policy')).toContain(`style-src ${APP}/x/fonts/fonts.css;`);
    expect(malformed.headers.get('content-security-policy')).toContain(`font-src ${APP}/x/fonts/;`);
    expect(malformed.headers.get('content-security-policy')).not.toContain('unsafe-inline');
  });

  it('refuses cleanly with the full header set while extensions are off or the lock is not held', async () => {
    state.env.ATMOBB_EXTENSIONS = 'off';
    const off = await frame({ path: 'index.html' });
    expect(off.status).toBe(503);
    expectFrameHeaders(off);
    delete state.env.ATMOBB_EXTENSIONS;
    state.lockHeld = false;
    const unlocked = await frame({ path: 'index.html' });
    expect(unlocked.status).toBe(503);
    expectFrameHeaders(unlocked);
  });

  it('answers an unexpected failure with the full header set', async () => {
    await writeFile(join(directory, 'extensions', 'registry.json'), '{not json');
    resetRegistryCacheForTests();
    const response = await frame({ path: 'index.html' });
    expect(response.status).toBe(500);
    expectFrameHeaders(response);
  });
});
