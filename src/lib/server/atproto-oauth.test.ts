import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OAuthSession } from '@atproto/oauth-client-node';
const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
import { MEMBER_SCOPE, MODERATION_SCOPE, STAMP_SCOPE, clientMetadata, forumScopeStatus, oauthClient, oauthScope, sysopScope } from './atproto-oauth';
import { ENDORSEMENT_SCOPE, refreshExtensionScopes } from './extensions/scopes';

// The scope strings every forum consented to before extensions existed.
const MEMBER_SCOPE_BEFORE_EXTENSIONS =
  'atproto include:app.atmobb.authForum rpc:pub.atmo.notify.requestPermission?aud=did%3Aweb%3Arelay.atmo.pub%23notif_relay blob:image/*';
const SYSOP_SCOPE_BEFORE_EXTENSIONS =
  'atproto include:app.atmobb.authSysop repo:app.atmobb.moderation.action?action=create repo:app.atmobb.forum.stamp blob:image/* blob:font/*';
const OAUTH_SCOPE_BEFORE_EXTENSIONS =
  'atproto include:app.atmobb.authForum rpc:pub.atmo.notify.requestPermission?aud=did%3Aweb%3Arelay.atmo.pub%23notif_relay include:app.atmobb.authSysop repo:app.atmobb.moderation.action?action=create repo:app.atmobb.forum.stamp blob:image/* blob:font/*';

const GAME = 'com.example.diplomacy.game';
const ORDER = 'com.example.diplomacy.order';

let directory: string;

async function writeInstalls(installs: { state: 'active' | 'disabled'; collections: string[] }[]) {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const store = {
    installs: installs.map((install, i) => ({ id: `install-${i}`, state: install.state, manifest: { collections: install.collections } })),
  };
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify(store));
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-oauth-test-'));
  vi.stubEnv('DATA_DIR', directory);
  await writeInstalls([]);
  await refreshExtensionScopes();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

describe('forum OAuth scopes', () => {
  it('requests moderation writes explicitly in both the sysop flow and client metadata', () => {
    expect(sysopScope().split(' ')).toContain(MODERATION_SCOPE);
    expect(oauthScope().split(' ')).toContain(MODERATION_SCOPE);
    expect(clientMetadata().scope.split(' ')).toContain(MODERATION_SCOPE);
  });

  it('requests stamp writes explicitly in both the sysop flow and client metadata', () => {
    expect(sysopScope().split(' ')).toContain(STAMP_SCOPE);
    expect(oauthScope().split(' ')).toContain(STAMP_SCOPE);
    expect(clientMetadata().scope.split(' ')).toContain(STAMP_SCOPE);
  });

  it('requests exactly the scopes it did before extensions when none are installed', () => {
    expect(MEMBER_SCOPE).toBe(MEMBER_SCOPE_BEFORE_EXTENSIONS);
    expect(sysopScope()).toBe(SYSOP_SCOPE_BEFORE_EXTENSIONS);
    expect(oauthScope()).toBe(OAUTH_SCOPE_BEFORE_EXTENSIONS);
    expect(clientMetadata().scope).toBe(OAUTH_SCOPE_BEFORE_EXTENSIONS);
  });

  it('requests exactly the scopes it did before extensions with ATMOBB_EXTENSIONS=off', async () => {
    state.env.ATMOBB_EXTENSIONS = 'off';
    state.env.ATMOBB_EXTENSION_DIRECTORY = '1';
    await writeInstalls([{ state: 'active', collections: [GAME, ORDER] }]);
    await refreshExtensionScopes();
    expect(sysopScope()).toBe(SYSOP_SCOPE_BEFORE_EXTENSIONS);
    expect(oauthScope()).toBe(OAUTH_SCOPE_BEFORE_EXTENSIONS);
    expect(clientMetadata().scope).toBe(OAUTH_SCOPE_BEFORE_EXTENSIONS);
  });

  it("adds an active extension's collections to client metadata and the sysop flow", async () => {
    state.env.ATMOBB_APP_URL = 'https://forum.example';
    await writeInstalls([{ state: 'active', collections: [GAME, ORDER] }]);
    await refreshExtensionScopes();
    expect(sysopScope()).toBe(`${SYSOP_SCOPE_BEFORE_EXTENSIONS} repo:${GAME} repo:${ORDER}`);
    expect(clientMetadata().scope.split(' ')).toEqual(expect.arrayContaining([`repo:${GAME}`, `repo:${ORDER}`]));
  });

  it("leaves a disabled extension's collections out", async () => {
    await writeInstalls([{ state: 'disabled', collections: [GAME] }]);
    await refreshExtensionScopes();
    expect(sysopScope()).toBe(SYSOP_SCOPE_BEFORE_EXTENSIONS);
    expect(clientMetadata().scope).toBe(OAUTH_SCOPE_BEFORE_EXTENSIONS);
  });

  it('requests the endorsement scope only when the forum runs the extension directory', () => {
    expect(clientMetadata().scope).not.toContain(ENDORSEMENT_SCOPE);
    expect(sysopScope()).not.toContain(ENDORSEMENT_SCOPE);
    state.env.ATMOBB_EXTENSION_DIRECTORY = '1';
    expect(clientMetadata().scope.split(' ')).toContain(ENDORSEMENT_SCOPE);
    expect(sysopScope().split(' ')).toContain(ENDORSEMENT_SCOPE);
  });

  it('never gives members extension scopes', async () => {
    state.env.ATMOBB_EXTENSION_DIRECTORY = '1';
    await writeInstalls([{ state: 'active', collections: [GAME] }]);
    await refreshExtensionScopes();
    expect(MEMBER_SCOPE).toBe(MEMBER_SCOPE_BEFORE_EXTENSIONS);
  });

  it('rebuilds the OAuth client when the scope changes, so the loopback client_id carries the new scopes', async () => {
    const before = oauthClient();
    expect(oauthClient()).toBe(before);
    expect(decodeURIComponent(before.clientMetadata.client_id)).not.toContain(`repo:${GAME}`);

    await writeInstalls([{ state: 'active', collections: [GAME] }]);
    await refreshExtensionScopes();
    const after = oauthClient();
    expect(after).not.toBe(before);
    const clientId = new URL(after.clientMetadata.client_id);
    expect(clientId.searchParams.get('scope')?.split(' ')).toContain(`repo:${GAME}`);
    expect(after.clientMetadata.scope?.split(' ')).toContain(`repo:${GAME}`);
  });

  it("asks for a reconnect when the forum session lacks a newly approved collection, and is ok once it's granted", async () => {
    let granted = `${SYSOP_SCOPE_BEFORE_EXTENSIONS} repo:${GAME}`;
    const session = { getTokenInfo: async () => ({ scope: granted }) } as unknown as OAuthSession;

    await writeInstalls([{ state: 'active', collections: [GAME, ORDER] }]);
    await refreshExtensionScopes();
    vi.spyOn(oauthClient(), 'restore').mockResolvedValue(session);
    expect(await forumScopeStatus('did:plc:forum')).toEqual({ ok: false, missing: [`repo:${ORDER}`] });

    granted = `${granted} repo:${ORDER}`;
    expect(await forumScopeStatus('did:plc:forum')).toEqual({ ok: true });
  });
});
