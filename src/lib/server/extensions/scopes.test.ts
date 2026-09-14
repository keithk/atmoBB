import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
import { BINDING_SCOPE, ENDORSEMENT_SCOPE, extensionScope, refreshExtensionScopes, scopeStatus } from './scopes';

let directory: string;

/** Write a registry holding installs with just the fields scopes read. */
async function writeInstalls(installs: { state: 'active' | 'disabled'; collections: string[] }[]) {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const store = {
    installs: installs.map((install, i) => ({ id: `install-${i}`, state: install.state, manifest: { collections: install.collections } })),
  };
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify(store));
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-scopes-test-'));
  vi.stubEnv('DATA_DIR', directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await writeInstalls([]);
  await refreshExtensionScopes();
  await rm(directory, { recursive: true, force: true });
});

describe('extension scopes', () => {
  it('is empty with no extensions installed', async () => {
    await refreshExtensionScopes();
    expect(extensionScope()).toBe('');
  });

  it("requests every collection of an active extension and none of a disabled one's", async () => {
    await writeInstalls([
      { state: 'active', collections: ['com.example.diplomacy.game', 'com.example.diplomacy.order'] },
      { state: 'disabled', collections: ['com.example.chess.move'] },
    ]);
    await refreshExtensionScopes();
    expect(extensionScope()).toBe('repo:com.example.diplomacy.game repo:com.example.diplomacy.order repo:app.atmobb.extension.binding');
  });

  it('requests the thread binding scope only while an extension is active', async () => {
    expect(BINDING_SCOPE).toBe('repo:app.atmobb.extension.binding');
    await writeInstalls([{ state: 'disabled', collections: ['com.example.chess.move'] }]);
    await refreshExtensionScopes();
    expect(extensionScope()).toBe('');

    await writeInstalls([{ state: 'active', collections: [] }]);
    await refreshExtensionScopes();
    expect(extensionScope()).toBe(BINDING_SCOPE);
  });

  it('requests nothing with ATMOBB_EXTENSIONS=off', async () => {
    state.env.ATMOBB_EXTENSIONS = 'off';
    state.env.ATMOBB_EXTENSION_DIRECTORY = '1';
    await writeInstalls([{ state: 'active', collections: ['com.example.diplomacy.game'] }]);
    await refreshExtensionScopes();
    expect(extensionScope()).toBe('');
  });

  it('requests the endorsement scope only when the forum runs the extension directory', async () => {
    await refreshExtensionScopes();
    expect(extensionScope()).not.toContain(ENDORSEMENT_SCOPE);
    state.env.ATMOBB_EXTENSION_DIRECTORY = '1';
    expect(extensionScope()).toBe(ENDORSEMENT_SCOPE);
    expect(ENDORSEMENT_SCOPE).toBe('repo:app.atmobb.extension.endorsement');
  });
});

describe('granted scope check', () => {
  const base = 'atproto include:app.atmobb.authSysop blob:image/*';

  it('asks for a reconnect when an update approves a collection the session lacks, and is ok once granted', async () => {
    await writeInstalls([{ state: 'active', collections: ['com.example.diplomacy.game'] }]);
    await refreshExtensionScopes();
    const granted = `${base} repo:com.example.diplomacy.game ${BINDING_SCOPE}`;
    expect(scopeStatus(granted)).toEqual({ ok: true });

    await writeInstalls([{ state: 'active', collections: ['com.example.diplomacy.game', 'com.example.diplomacy.order'] }]);
    await refreshExtensionScopes();
    expect(scopeStatus(granted)).toEqual({ ok: false, missing: ['repo:com.example.diplomacy.order'] });
    expect(scopeStatus(`${granted} repo:com.example.diplomacy.order`)).toEqual({ ok: true });
  });

  it('is ok with no extensions', async () => {
    await refreshExtensionScopes();
    expect(scopeStatus(base)).toEqual({ ok: true });
  });
});
