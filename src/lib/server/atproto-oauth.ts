import { Agent } from '@atproto/api';
import { env } from '$env/dynamic/private';
import { extensionScope, scopeStatus, type ScopeStatus } from './extensions/scopes';
import { OAuthConfigurationError, SecureHappyViewOAuth, type OAuthPurpose } from './happyview-oauth';

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
//
// Extensions add to the forum account's side only: a repo scope for each
// collection approved for an active install (see extensions/scopes.ts). With
// none installed, or ATMOBB_EXTENSIONS=off, the strings are exactly the base
// ones below. Members never get extension scopes.
export const NOTIFY_RELAY_DID = 'did:web:relay.atmo.pub';
export const NOTIFY_RELAY_AUD = `${NOTIFY_RELAY_DID}#notif_relay`;
const NOTIFY_SCOPE = `rpc:pub.atmo.notify.requestPermission?aud=${encodeURIComponent(NOTIFY_RELAY_AUD)}`;
// Keep the moderation and stamp grants explicit as well as in authSysop.
// Existing PDSes may have cached an older copy of the permission set from
// before they were added; the granular scopes make a reconnect reliably
// refresh these grants. Admins create, edit, and delete stamps.
export const MODERATION_SCOPE = 'repo:app.atmobb.moderation.action?action=create';
export const STAMP_SCOPE = 'repo:app.atmobb.forum.stamp';
const SYSOP_GRANTS = `include:app.atmobb.authSysop ${MODERATION_SCOPE} ${STAMP_SCOPE}`;
const MEMBER_SET = `include:app.atmobb.authForum ${NOTIFY_SCOPE}`;
export const MEMBER_SCOPE = `atproto ${MEMBER_SET} blob:image/*`;
const SYSOP_BASE_SCOPE = `atproto ${SYSOP_GRANTS} blob:image/* blob:font/*`;
const OAUTH_BASE_SCOPE = `atproto ${MEMBER_SET} ${SYSOP_GRANTS} blob:image/* blob:font/*`;

const withExtensions = (base: string) => [base, extensionScope()].filter(Boolean).join(' ');
/** What the sysop connect flow asks the forum account for. */
export const sysopScope = () => withExtensions(SYSOP_BASE_SCOPE);
/** Everything the client may ask for, as client metadata declares it. */
export const oauthScope = () => withExtensions(OAUTH_BASE_SCOPE);

const appUrl = () => env.ATMOBB_APP_URL ?? 'http://127.0.0.1:5173';

let client: { instance: SecureHappyViewOAuth; key: string } | null = null;

// In production (https app URL) the client_id is the hosted metadata document,
// which the /oauth-client-metadata.json route serves. In dev it's the atproto
// loopback client exception.
export function clientMetadata() {
  const base = appUrl();
  const redirectUri = `${base}/oauth/callback`;
  const isLocal = base.startsWith('http://');
  const scope = oauthScope();
  const clientId = isLocal
    ? `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`
    : `${base}/oauth-client-metadata.json`;
  return {
    client_id: clientId,
    client_name: isLocal ? 'atmoBB (dev)' : 'atmoBB',
    client_uri: base,
    redirect_uris: [redirectUri] as [string],
    scope,
    grant_types: ['authorization_code', 'refresh_token'] as ['authorization_code', 'refresh_token'],
    response_types: ['code'] as ['code'],
    application_type: 'web' as const,
    token_endpoint_auth_method: 'none' as const,
    dpop_bound_access_tokens: true,
  };
}

export function oauthClient(): SecureHappyViewOAuth {
  const metadata = clientMetadata();
  const clientKey = env.HAPPYVIEW_CLIENT_KEY?.trim();
  if (!clientKey) throw new OAuthConfigurationError('OAuth requires HAPPYVIEW_CLIENT_KEY. Configure the public HappyView API client key and reconnect; do not use an admin key.');
  const registeredClientId = env.HAPPYVIEW_OAUTH_CLIENT_ID;
  if (appUrl().startsWith('http://') && !registeredClientId) {
    throw new OAuthConfigurationError('Local OAuth requires HAPPYVIEW_OAUTH_CLIENT_ID matching clientMetadata().client_id and the HappyView API client registration. Preserve the localhost loopback ID; do not register an HTTP metadata URL.');
  }
  if (registeredClientId && registeredClientId !== metadata.client_id) {
    throw new OAuthConfigurationError('HAPPYVIEW_OAUTH_CLIENT_ID does not match the current OAuth metadata client_id. Update the HappyView API client registration and environment together before starting login.');
  }
  const options = {
    instanceUrl: (env.HAPPYVIEW_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    appUrl: appUrl(), clientId: metadata.client_id, clientKey,
    redirectUri: metadata.redirect_uris[0],
    dataDir: process.env.DATA_DIR ?? '.data',
    forumDid: () => env.ATMOBB_FORUM_DID ?? 'did:plc:atmobbdevforum',
  };
  const key = JSON.stringify(options);
  if (client?.key === key) return client.instance;
  const instance = new SecureHappyViewOAuth(options);
  client = { instance, key };
  return instance;
}

/**
 * Whether the forum account's stored session was granted every scope
 * extensions currently need; `missing` lists what a reconnect would add.
 * Throws when the account has no session.
 */
export async function forumScopeStatus(forumDid: string): Promise<ScopeStatus> {
  const session = await oauthClient().restore(forumDid, false, 'forum');
  const { scope } = session.getTokenInfo();
  return scopeStatus(scope ?? '');
}

export async function agentFor(did: string, purpose?: OAuthPurpose): Promise<Agent> {
  const session = await oauthClient().restore(did, false, purpose);
  return new Agent(session);
}

/** Authenticated as-DID fetch to this instance only; never accepts an external URL. */
export function happyViewFetch(did: string, path: string, init?: RequestInit, purpose?: OAuthPurpose) {
  return oauthClient().fetch(did, path, init, purpose);
}
