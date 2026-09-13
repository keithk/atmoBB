import {
  NodeOAuthClient,
  requestLocalLock,
  type NodeSavedSession,
  type NodeSavedState,
} from '@atproto/oauth-client-node';
import { Agent } from '@atproto/api';
import { env } from '$env/dynamic/private';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Blob scopes are requested directly: they can't be bundled into a permission
// set. Members upload images; the forum account can also own custom webfonts.
//
// Two audiences, two permission sets: members consent to authForum (posting,
// joining, profile); the forum account itself consents to authSysop (boards,
// categories, mounts, staff, moderation) when a sysop connects it. Client
// metadata must carry the union; each authorize request asks for its subset.
//
// Asking atmo.pub to deliver notifications is an rpc grant for a method
// outside app.atmobb, and a permission set may only carry methods under its
// own authority (the PDS drops the rest when it expands the include), so it
// is requested as a granular scope of its own, relay audience and all.
export const NOTIFY_RELAY_DID = 'did:web:relay.atmo.pub';
export const NOTIFY_RELAY_AUD = `${NOTIFY_RELAY_DID}#notif_relay`;
const NOTIFY_SCOPE = `rpc:pub.atmo.notify.requestPermission?aud=${encodeURIComponent(NOTIFY_RELAY_AUD)}`;
// Keep the moderation grant explicit as well as in authSysop. Existing PDSes
// may have cached an older copy of the permission set from before moderation
// was added; the granular scope makes a reconnect reliably refresh this grant.
export const MODERATION_SCOPE = 'repo:app.atmobb.moderation.action?action=create';
const MEMBER_SET = `include:app.atmobb.authForum ${NOTIFY_SCOPE}`;
export const MEMBER_SCOPE = `atproto ${MEMBER_SET} blob:image/*`;
export const SYSOP_SCOPE =
  `atproto include:app.atmobb.authSysop ${MODERATION_SCOPE} blob:image/* blob:font/*`;
export const OAUTH_SCOPE =
  `atproto ${MEMBER_SET} include:app.atmobb.authSysop ${MODERATION_SCOPE} blob:image/* blob:font/*`;

const appUrl = () => env.ATMOBB_APP_URL ?? 'http://127.0.0.1:5173';

// File-backed persistence: .data/ in dev, the deploy platform's persistent
// volume (DATA_DIR=/data) in production. A real database store can replace
// this when the platform grows one.
class FileStore<T> {
  private dir: string;
  constructor(name: string) {
    this.dir = join(process.env.DATA_DIR ?? '.data', name);
    mkdirSync(this.dir, { recursive: true });
  }
  private file(key: string) {
    return join(this.dir, encodeURIComponent(key) + '.json');
  }
  async get(key: string): Promise<T | undefined> {
    const f = this.file(key);
    if (!existsSync(f)) return undefined;
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  }
  async set(key: string, value: T): Promise<void> {
    writeFileSync(this.file(key), JSON.stringify(value));
  }
  async del(key: string): Promise<void> {
    const f = this.file(key);
    if (existsSync(f)) unlinkSync(f);
  }
}

let client: NodeOAuthClient | null = null;

// In production (https app URL) the client_id is the hosted metadata document,
// which the /oauth-client-metadata.json route serves. In dev it's the atproto
// loopback client exception.
export function clientMetadata() {
  const base = appUrl();
  const redirectUri = `${base}/oauth/callback`;
  const isLocal = base.startsWith('http://');
  const clientId = isLocal
    ? `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(OAUTH_SCOPE)}`
    : `${base}/oauth-client-metadata.json`;
  return {
    client_id: clientId,
    client_name: isLocal ? 'atmoBB (dev)' : 'atmoBB',
    client_uri: base,
    redirect_uris: [redirectUri] as [string],
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'] as ['authorization_code', 'refresh_token'],
    response_types: ['code'] as ['code'],
    application_type: 'web' as const,
    token_endpoint_auth_method: 'none' as const,
    dpop_bound_access_tokens: true,
  };
}

export function oauthClient(): NodeOAuthClient {
  if (client) return client;
  client = new NodeOAuthClient({
    clientMetadata: clientMetadata(),
    stateStore: new FileStore<NodeSavedState>('oauth-state'),
    sessionStore: new FileStore<NodeSavedSession>('oauth-sessions'),
    requestLock: requestLocalLock,
  });
  return client;
}

export async function agentFor(did: string): Promise<Agent> {
  const session = await oauthClient().restore(did);
  return new Agent(session);
}
