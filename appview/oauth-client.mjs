// HappyView 2.16.0 admin contract (cb3cd86). Setup-only: never ship the admin
// key to the web app. This registered ceiling is NOT the scope requested at
// login. App-hosted metadata and each member/forum authorization retain exact
// grants; repo:* lets approved plugins add collections without admin access.
// PDS consent and the plugin host's per-install allowlist still apply.
import { pathToFileURL } from 'node:url';

export const CLIENT_CEILING = 'atproto include:app.atmobb.authForum include:app.atmobb.authSysop repo:* blob:image/* blob:font/* rpc:pub.atmo.notify.requestPermission?aud=did%3Aweb%3Arelay.atmo.pub%23notif_relay';

export async function configureClient(env, mode = 'verify', request = fetch) {
  if (!['verify', 'configure'].includes(mode)) throw new Error('Use verify or configure');
  if (!env.HAPPYVIEW_API_KEY) throw new Error('HAPPYVIEW_API_KEY is required by setup only');
  if (!env.ATMOBB_APP_URL) throw new Error('ATMOBB_APP_URL is required');
  const origin = new URL(env.ATMOBB_APP_URL).origin;
  if (env.ATMOBB_APP_URL.replace(/\/$/, '') !== origin) {
    throw new Error('ATMOBB_APP_URL must be an origin without a path');
  }
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('ATMOBB_APP_URL requires HTTPS except on loopback');
  }
  if (url.protocol === 'http:' && !env.HAPPYVIEW_OAUTH_CLIENT_ID) {
    throw new Error('Loopback setup requires HAPPYVIEW_OAUTH_CLIENT_ID matching the app metadata http://localhost?redirect_uri=...&scope=... client_id');
  }
  const desired = {
    name: 'atmoBB', client_type: 'public',
    client_id_url: env.HAPPYVIEW_OAUTH_CLIENT_ID || `${origin}/oauth-client-metadata.json`,
    client_uri: origin, redirect_uris: [`${origin}/oauth/callback`],
    allowed_origins: [origin], scopes: CLIENT_CEILING,
  };
  async function admin(path, method = 'GET', body) {
    const response = await request(`${(env.HV || 'http://127.0.0.1:3000').replace(/\/$/, '')}/admin/api-clients${path}`, {
      method, headers: { Authorization: `Bearer ${env.HAPPYVIEW_API_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Do not print response bodies: admin failures can contain credentials.
    if (!response.ok) throw new Error(`HappyView API-client ${method} failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  }
  const clients = await admin('');
  const candidates = clients.filter(client => env.HAPPYVIEW_CLIENT_KEY
    ? client.client_key === env.HAPPYVIEW_CLIENT_KEY
    : client.client_id_url === desired.client_id_url);
  if (candidates.length > 1) throw new Error('Multiple clients match; explicitly set HAPPYVIEW_CLIENT_KEY');
  let client = candidates[0];
  if (!client && env.HAPPYVIEW_CLIENT_KEY) throw new Error('Configured HAPPYVIEW_CLIENT_KEY was not found; recover it in HappyView admin before retrying');
  if (!client && mode === 'verify') throw new Error('No public OAuth client; run ./atmobb configure-oauth (or node appview/oauth-client.mjs configure) and persist HAPPYVIEW_CLIENT_KEY');
  if (client && (client.client_type !== 'public' || client.client_id_url !== desired.client_id_url)) {
    throw new Error('Existing client has a different type or metadata URL; provision a public client explicitly, then set HAPPYVIEW_CLIENT_KEY. It cannot be converted safely');
  }
  if (client && !client.is_active) throw new Error('Configured OAuth client is inactive; review and reactivate it in HappyView admin');
  if (mode === 'configure') {
    if (client) {
      const { client_type, client_id_url, ...mutable } = desired;
      await admin(`/${encodeURIComponent(client.id)}`, 'PUT', mutable);
    } else {
      client = await admin('', 'POST', desired);
    }
  } else {
    if (!env.HAPPYVIEW_CLIENT_KEY) throw new Error('Public OAuth client exists; run ./atmobb configure-oauth to recover and persist HAPPYVIEW_CLIENT_KEY');
    const scopes = value => value.trim().split(/\s+/).sort().join(' ');
    if (client.client_uri !== desired.client_uri ||
        JSON.stringify(client.redirect_uris) !== JSON.stringify(desired.redirect_uris) ||
        JSON.stringify(client.allowed_origins) !== JSON.stringify(desired.allowed_origins) ||
        scopes(client.scopes) !== scopes(desired.scopes)) {
      throw new Error('OAuth client configuration differs; run ./atmobb configure-oauth to explicitly synchronize the client ceiling and allowed Origin');
    }
  }
  if (!/^hvc_[a-zA-Z0-9]+$/.test(client.client_key)) throw new Error('HappyView returned an invalid public client key');
  return client.client_key;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configureClient(process.env, process.argv[2]).then(key => {
    if (process.argv[2] === 'configure') console.log(`HAPPYVIEW_CLIENT_KEY=${key}`);
  }).catch(error => {
    console.error(`atmobb OAuth setup: ${error.message}`);
    process.exitCode = 1;
  });
}
