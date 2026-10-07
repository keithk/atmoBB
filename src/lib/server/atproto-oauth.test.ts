import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HappyViewSession } from '@happyview/oauth-client';
const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
import { GUESTBOOK_SCOPE, MEMBER_SCOPE, MODERATION_SCOPE, STAMP_SCOPE, clientMetadata, forumScopeStatus, oauthClient, oauthScope, sysopScope } from './atproto-oauth';
import { BINDING_SCOPE, ENDORSEMENT_SCOPE, refreshExtensionScopes } from './extensions/scopes';

// The scope strings every forum consented to before extensions existed.
const MEMBER_SCOPE_BEFORE_EXTENSIONS =
  'atproto include:app.atmobb.authForum repo:app.atmobb.actor.guestbook rpc:pub.atmo.notify.requestPermission?aud=did%3Aweb%3Arelay.atmo.pub%23notif_relay blob:image/*';
const SYSOP_SCOPE_BEFORE_EXTENSIONS =
  'atproto include:app.atmobb.authSysop repo:app.atmobb.moderation.action?action=create repo:app.atmobb.forum.stamp blob:image/* blob:font/*';
const OAUTH_SCOPE_BEFORE_EXTENSIONS =
  'atproto include:app.atmobb.authForum repo:app.atmobb.actor.guestbook rpc:pub.atmo.notify.requestPermission?aud=did%3Aweb%3Arelay.atmo.pub%23notif_relay include:app.atmobb.authSysop repo:app.atmobb.moderation.action?action=create repo:app.atmobb.forum.stamp blob:image/* blob:font/*';

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
  state.env.HAPPYVIEW_CLIENT_KEY = 'public-test-client';
  state.env.ATMOBB_APP_URL = 'https://forum.example';
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

  it('requests guestbook writes explicitly in the member flow and client metadata', () => {
    expect(MEMBER_SCOPE.split(' ')).toContain(GUESTBOOK_SCOPE);
    expect(oauthScope().split(' ')).toContain(GUESTBOOK_SCOPE);
    expect(clientMetadata().scope.split(' ')).toContain(GUESTBOOK_SCOPE);
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
    expect(sysopScope()).toBe(`${SYSOP_SCOPE_BEFORE_EXTENSIONS} repo:${GAME} repo:${ORDER} ${BINDING_SCOPE}`);
    expect(clientMetadata().scope.split(' ')).toEqual(expect.arrayContaining([`repo:${GAME}`, `repo:${ORDER}`, BINDING_SCOPE]));
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

  it('rebuilds the OAuth adapter when the loopback metadata scope changes', async () => {
    state.env.ATMOBB_APP_URL = 'http://127.0.0.1:5173';
    state.env.HAPPYVIEW_OAUTH_CLIENT_ID = clientMetadata().client_id;
    const before = oauthClient();
    expect(oauthClient()).toBe(before);
    expect(decodeURIComponent(clientMetadata().client_id)).not.toContain(`repo:${GAME}`);

    await writeInstalls([{ state: 'active', collections: [GAME] }]);
    await refreshExtensionScopes();
    expect(() => oauthClient()).toThrow('does not match');
    state.env.HAPPYVIEW_OAUTH_CLIENT_ID = clientMetadata().client_id;
    const after = oauthClient();
    expect(after).not.toBe(before);
    const clientId = new URL(clientMetadata().client_id);
    expect(clientId.searchParams.get('scope')?.split(' ')).toContain(`repo:${GAME}`);
    expect(clientMetadata().scope.split(' ')).toContain(`repo:${GAME}`);
  });

  it('requires the public HappyView client key for OAuth but not public metadata', () => {
    delete state.env.HAPPYVIEW_CLIENT_KEY;
    expect(() => oauthClient()).toThrow('HAPPYVIEW_CLIENT_KEY');
    expect(clientMetadata().scope).toBe(OAUTH_SCOPE_BEFORE_EXTENSIONS);
  });

  it('requires an explicit matching loopback registration for local OAuth', () => {
    state.env.ATMOBB_APP_URL = 'http://127.0.0.1:5173';
    expect(() => oauthClient()).toThrow('Local OAuth requires HAPPYVIEW_OAUTH_CLIENT_ID');
    state.env.HAPPYVIEW_OAUTH_CLIENT_ID = 'http://127.0.0.1:5173/oauth-client-metadata.json';
    expect(() => oauthClient()).toThrow('does not match');
    state.env.HAPPYVIEW_OAUTH_CLIENT_ID = clientMetadata().client_id;
    expect(() => oauthClient()).not.toThrow();
    expect(clientMetadata().client_id).toMatch(/^http:\/\/localhost\?/);
  });

  it("asks for a reconnect when the forum session lacks a newly approved collection, and is ok once it's granted", async () => {
    let granted = `${SYSOP_SCOPE_BEFORE_EXTENSIONS} repo:${GAME} ${BINDING_SCOPE}`;
    const session = { getTokenInfo: () => ({ scope: granted }) } as unknown as HappyViewSession;

    await writeInstalls([{ state: 'active', collections: [GAME, ORDER] }]);
    await refreshExtensionScopes();
    vi.spyOn(oauthClient(), 'restore').mockResolvedValue(session);
    expect(await forumScopeStatus('did:plc:forum')).toEqual({ ok: false, missing: [`repo:${ORDER}`] });

    granted = `${granted} repo:${ORDER}`;
    expect(await forumScopeStatus('did:plc:forum')).toEqual({ ok: true });
  });
});
