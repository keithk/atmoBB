import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_CEILING, configureClient } from './oauth-client.mjs';

const env = { ATMOBB_APP_URL: 'https://forum.example', HAPPYVIEW_API_KEY: 'hv_synthetic', HV: 'http://fixture' };
const existing = {
  id: 'client-id', client_key: 'hvc_synthetic', client_type: 'public', is_active: true,
  client_id_url: `${env.ATMOBB_APP_URL}/oauth-client-metadata.json`,
  client_uri: env.ATMOBB_APP_URL, redirect_uris: [`${env.ATMOBB_APP_URL}/oauth/callback`],
  allowed_origins: [env.ATMOBB_APP_URL], scopes: CLIENT_CEILING,
};
function fixture(clients = [], failMethod) {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, ...options, body: options.body && JSON.parse(options.body) });
      if (options.method === failMethod) return new Response('secret must not be logged', { status: 403 });
      if (options.method === 'PUT') return new Response(null, { status: 204 });
      return Response.json(options.method === 'GET' ? clients : existing);
    },
  };
}
test('creates a public client without fetching web metadata; ceiling is not consent', async () => {
  const f = fixture();
  assert.equal(await configureClient(env, 'configure', f.request), 'hvc_synthetic');
  assert.equal(f.calls[1].body.client_type, 'public');
  assert.deepEqual(f.calls[1].body.allowed_origins, ['https://forum.example']);
  assert.equal(f.calls[1].body.client_id_url, existing.client_id_url);
  assert.ok(CLIENT_CEILING.includes('repo:*'));
  assert.ok(!CLIENT_CEILING.includes('transition:generic'));
  assert.ok(!CLIENT_CEILING.includes('blob:*'));
});
test('configured key wins and explicit configure synchronizes mutable fields', async () => {
  const f = fixture([existing, { ...existing, id: 'other', client_key: 'hvc_other' }]);
  await configureClient({ ...env, HAPPYVIEW_CLIENT_KEY: existing.client_key }, 'configure', f.request);
  assert.equal(f.calls[1].url, 'http://fixture/admin/api-clients/client-id');
  assert.equal(f.calls[1].method, 'PUT');
  assert.equal(f.calls[1].body.scopes, CLIENT_CEILING);
  assert.equal(f.calls[1].body.client_type, undefined);
});
test('recovers unique matching client without creating another identity', async () => {
  const f = fixture([existing]);
  assert.equal(await configureClient(env, 'configure', f.request), existing.client_key);
  assert.equal(f.calls[1].method, 'PUT');
});
test('verify is read-only; drift and missing configured key fail closed', async () => {
  const f = fixture([existing]);
  await configureClient({ ...env, HAPPYVIEW_CLIENT_KEY: existing.client_key }, 'verify', f.request);
  assert.equal(f.calls.length, 1);
  await assert.rejects(configureClient(env, 'verify', f.request), /recover and persist/);
  const drift = fixture([{ ...existing, scopes: 'atproto' }]);
  await assert.rejects(configureClient({ ...env, HAPPYVIEW_CLIENT_KEY: existing.client_key }, 'verify', drift.request), /differs/);
  assert.equal(drift.calls.length, 1);
});
test('missing, ambiguous, confidential and inactive identities are never silently replaced', async () => {
  for (const [clients, key, pattern] of [
    [[], 'hvc_missing', /not found/],
    [[existing, existing], '', /Multiple/],
    [[{ ...existing, client_type: 'confidential' }], '', /different type/],
    [[{ ...existing, is_active: false }], '', /inactive/],
  ]) {
    const f = fixture(clients);
    await assert.rejects(configureClient({ ...env, HAPPYVIEW_CLIENT_KEY: key }, 'configure', f.request), pattern);
    assert.equal(f.calls.length, 1);
  }
});
test('admin failures reject without including response body or credentials', async () => {
  for (const method of ['GET', 'POST', 'PUT']) {
    const f = fixture(method === 'PUT' ? [existing] : [], method);
    await assert.rejects(configureClient(env, 'configure', f.request), error => {
      assert.match(error.message, /failed \(403\)/);
      assert.ok(!error.message.includes('secret'));
      assert.ok(!error.message.includes(env.HAPPYVIEW_API_KEY));
      return true;
    });
  }
});

test('loopback requires the exact SDK metadata client ID rather than hosted HTTP', async () => {
  const local = { ...env, ATMOBB_APP_URL: 'http://127.0.0.1:5173' };
  const f = fixture();
  await assert.rejects(configureClient(local, 'configure', f.request), /Loopback setup requires/);
  assert.equal(f.calls.length, 0);
  const clientId = 'http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Foauth%2Fcallback&scope=atproto';
  await configureClient({ ...local, HAPPYVIEW_OAUTH_CLIENT_ID: clientId }, 'configure', f.request);
  assert.equal(f.calls[1].body.client_id_url, clientId);
  assert.deepEqual(f.calls[1].body.allowed_origins, [local.ATMOBB_APP_URL]);
});
