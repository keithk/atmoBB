// A compatibility probe, not an atmoBB authentication implementation.
// Real published SDKs and cryptography; synthetic identity/OAuth/HTTP services.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Agent } from '@atproto/api';
import { HappyViewNodeClient } from '@happyview/oauth-client-node';
import { MemoryStorage } from '@happyview/oauth-client';
import { hash, thumbprint, verifyProof } from './proof.mjs';

const HV = 'https://happyview.example.test';
const PDS = 'https://pds.example.test';
const ISSUER = 'https://auth.example.test';
const MEMBER = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const FORUM = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const CID = 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const THREAD = 'app.atmobb.discussion.thread';
const MEMBER_SCOPE = 'atproto include:app.atmobb.authForum blob:image/*';
const FORUM_SCOPE = 'atproto include:app.atmobb.authSysop blob:image/* blob:font/*';
const RELAY = 'did:web:relay.atmo.pub#notif_relay';
const json = (value, status = 200, headers = {}) =>
  Response.json(value, { status, headers });

async function key() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  // Match HappyView's provision response, not WebCrypto's sign-only key_ops.
  const { kty, crv, x, y, d } = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  return { kty, crv, x, y, d };
}

// The fetch double is a closed network boundary: every unexpected URL throws.
// It does not emulate HappyView's refresh, authorization, or migration logic.
async function fixture(storage = new MemoryStorage()) {
  const calls = [];
  const pars = [];
  const registrations = [];
  const keys = new Map();
  const parKeys = new Map();
  const issuedTokens = new Map();
  const registeredKeys = new Set();
  let xrpc = () => json({});
  let tokenScopes;
  let rejectParNonce = false;
  const authenticate = async (request) => {
    const authorization = request.headers.get('authorization');
    assert.ok(authorization?.startsWith('DPoP '), 'authenticated requests require a DPoP access token');
    const token = authorization.slice(5);
    const issued = issuedTokens.get(token);
    assert.ok(issued, 'request must use an issued access token');
    assert.ok(registeredKeys.has(thumbprint(issued.jwk)), 'request must use a live registered session');
    return { issued, proof: await verifyProof(request, issued.jwk, token) };
  };
  const fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const bytes = new Uint8Array(await request.clone().arrayBuffer());
    const call = { url: request.url, method: request.method, headers: request.headers, bytes };
    calls.push(call);
    if (request.url === `${PDS}/.well-known/oauth-protected-resource`) {
      return json({ resource: PDS, authorization_servers: [ISSUER] });
    }
    if (request.url.startsWith(`${ISSUER}/.well-known/`)) {
      return json({
        issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`, pushed_authorization_request_endpoint: `${ISSUER}/par`,
      });
    }
    if (request.url === `${HV}/oauth/dpop-keys`) {
      const provision = `provision-${keys.size + 1}`;
      const jwk = await key();
      keys.set(provision, { jwk, challenge: (await request.json()).pkce_challenge });
      return json({ provision_id: provision, dpop_key: jwk, confidential: false });
    }
    if (request.url === `${ISSUER}/par`) {
      const params = new URLSearchParams(await request.text());
      pars.push(params);
      const provisionedKey = [...keys.values()].at(-1).jwk;
      assert.equal(params.get('dpop_jkt'), thumbprint(provisionedKey), 'PAR must bind the provisioned signing key');
      parKeys.set(params.get('state'), provisionedKey);
      if (rejectParNonce) {
        return json({ error: 'use_dpop_nonce' }, 400, { 'dpop-nonce': 'par-nonce' });
      }
      return json({ request_uri: `urn:synthetic:par:${pars.length}`, expires_in: 90 });
    }
    if (request.url === `${ISSUER}/token`) {
      const params = new URLSearchParams(await request.text());
      assert.equal(params.get('grant_type'), 'authorization_code');
      const par = pars.findLast((p) => p.get('login_hint') === params.get('code'));
      assert.ok(par);
      assert.equal(hash(params.get('code_verifier')), par.get('code_challenge'));
      const jwk = parKeys.get(par.get('state'));
      await verifyProof(request, jwk);
      const accessToken = `synthetic-access-${pars.indexOf(par)}`;
      issuedTokens.set(accessToken, {
        did: params.get('code') === 'forum.test' ? FORUM : MEMBER, jwk,
      });
      return json({
        access_token: accessToken,
        refresh_token: 'synthetic-refresh',
        token_type: 'DPoP',
        sub: params.get('code') === 'forum.test' ? FORUM : MEMBER,
        ...(tokenScopes === null ? {} : { scope: tokenScopes ?? par.get('scope') }),
        iss: ISSUER,
      });
    }
    if (request.url === `${HV}/oauth/sessions` && request.method === 'POST') {
      const body = await request.json();
      const provision = keys.get(body.provision_id);
      assert.ok(provision);
      assert.equal(hash(body.pkce_verifier), provision.challenge);
      assert.equal(body.pds_url, PDS);
      const issued = issuedTokens.get(body.access_token);
      assert.ok(issued);
      assert.equal(issued.did, body.did);
      assert.equal(thumbprint(issued.jwk), thumbprint(provision.jwk));
      registeredKeys.add(thumbprint(provision.jwk));
      registrations.push(body);
      return json({ did: body.did });
    }
    if (url.origin === HV && url.pathname.startsWith('/oauth/sessions/')) {
      const { issued } = await authenticate(request);
      assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)), issued.did);
      if (request.method === 'DELETE') registeredKeys.delete(thumbprint(issued.jwk));
      return json({});
    }
    if (url.origin === HV && url.pathname.startsWith('/xrpc/')) {
      const { proof } = await authenticate(request);
      call.proof = proof;
      assert.equal(request.headers.get('x-client-key'), 'synthetic-client');
      return xrpc(request, call);
    }
    throw new Error(`Unimplemented synthetic endpoint: ${request.method} ${request.url}`);
  };
  const makeClient = (store = storage) => {
    const client = new HappyViewNodeClient({
      instanceUrl: HV, clientId: 'https://forum.example.test/oauth-client-metadata.json',
      clientKey: 'synthetic-client', redirectUri: 'https://forum.example.test/oauth/callback',
      scopes: `${MEMBER_SCOPE} ${FORUM_SCOPE}`, storage: store, fetch,
    });
    // Resolve only the two synthetic accounts; no real DNS, DID, or PDS requests.
    client.handleResolver.resolve = async (handle) => {
      assert.ok(['member.test', 'forum.test'].includes(handle));
      return handle === 'forum.test' ? FORUM : MEMBER;
    };
    client.didResolver.resolve = async (did) => ({
      id: did, service: [{ id: `${did}#atproto_pds`, type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    });
    return client;
  };
  const client = makeClient();
  const login = async (handle = 'member.test', scope = MEMBER_SCOPE) => {
    await client.authorize(handle, { scope });
    return client.callback(new URLSearchParams({
      state: pars.at(-1).get('state'), code: handle, iss: ISSUER,
    }));
  };
  return {
    client, makeClient, login, storage, calls, pars, registrations,
    respond: (handler) => { xrpc = handler; },
    setTokenScopes: (value) => { tokenScopes = value; },
    challengePar: () => { rejectParNonce = true; },
  };
}

test('real SDK callback registers member and forum separately; restored Agent writes through HV', async () => {
  const f = await fixture();
  await f.login();
  await f.login('forum.test', FORUM_SCOPE);
  assert.equal(f.registrations[0].scopes, MEMBER_SCOPE);
  assert.equal(f.registrations[1].scopes, FORUM_SCOPE);
  f.respond(async (request) => {
    const body = await request.json();
    return json({ uri: `at://${body.repo}/${body.collection}/trial`, cid: CID });
  });
  // Re-create the client, not just the Agent, to exercise restore by DID.
  for (const did of [MEMBER, FORUM]) {
    const session = await f.makeClient().restore(did);
    assert.equal(session.did, did);
    const result = await new Agent(session).com.atproto.repo.createRecord({
      repo: did, collection: THREAD, record: { $type: THREAD, text: 'Synthetic trial' },
    });
    assert.equal(result.data.uri, `at://${did}/${THREAD}/trial`);
  }
  const writes = f.calls.filter((c) => c.url.includes('/xrpc/'));
  assert.equal(writes.length, 2);
  for (const [index, did] of [MEMBER, FORUM].entries()) {
    assert.equal(writes[index].url, `${HV}/xrpc/com.atproto.repo.createRecord`);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(writes[index].bytes)), {
      repo: did, collection: THREAD, record: { $type: THREAD, text: 'Synthetic trial' },
    });
  }
  assert.notEqual(writes[0].headers.get('authorization'), writes[1].headers.get('authorization'));
});

test('put/delete/batch/list records retain the Agent request shape through HV', async () => {
  const f = await fixture();
  const { session } = await f.login('forum.test', FORUM_SCOPE);
  const agent = new Agent(session);
  const uri = `at://${FORUM}/${THREAD}/trial`;
  f.respond((request) => {
    const method = new URL(request.url).pathname.split('/').at(-1);
    if (method.endsWith('listRecords')) return json({ records: [] });
    if (method.endsWith('putRecord')) return json({ uri, cid: CID });
    return json({});
  });
  await agent.com.atproto.repo.putRecord({
    repo: FORUM, collection: THREAD, rkey: 'trial', record: { $type: THREAD, text: 'Updated' },
  });
  await agent.com.atproto.repo.deleteRecord({ repo: FORUM, collection: THREAD, rkey: 'trial' });
  await agent.com.atproto.repo.applyWrites({
    repo: FORUM, writes: [{ $type: 'com.atproto.repo.applyWrites#delete', collection: THREAD, rkey: 'trial' }],
  });
  await agent.com.atproto.repo.listRecords({ repo: FORUM, collection: THREAD, limit: 100, cursor: 'page-2' });
  const requests = f.calls.filter((c) => c.url.includes('/xrpc/'));
  assert.deepEqual(requests.map((c) => c.method), ['POST', 'POST', 'POST', 'GET']);
  assert.deepEqual(requests.map((c) => c.url.split('?')[0]), [
    'putRecord', 'deleteRecord', 'applyWrites', 'listRecords',
  ].map((method) => `${HV}/xrpc/com.atproto.repo.${method}`));
  assert.deepEqual(Object.fromEntries(new URL(requests[3].url).searchParams), {
    repo: FORUM, collection: THREAD, limit: '100', cursor: 'page-2',
  });
  assert.deepEqual(requests.slice(0, 3).map((c) => JSON.parse(new TextDecoder().decode(c.bytes))), [
    { repo: FORUM, collection: THREAD, rkey: 'trial', record: { $type: THREAD, text: 'Updated' } },
    { repo: FORUM, collection: THREAD, rkey: 'trial' },
    { repo: FORUM, writes: [{ $type: 'com.atproto.repo.applyWrites#delete', collection: THREAD, rkey: 'trial' }] },
  ]);
});

test('image and font uploads preserve bytes and MIME; service-auth remains a GET with audience and method', async () => {
  const f = await fixture();
  const { session } = await f.login();
  const agent = new Agent(session);
  const { session: forumSession } = await f.login('forum.test', FORUM_SCOPE);
  f.respond((request, call) => {
    if (request.url.includes('uploadBlob')) {
      return json({ blob: { $type: 'blob', ref: { $link: CID }, mimeType: request.headers.get('content-type'), size: call.bytes.length } });
    }
    return json({ token: 'synthetic-service-auth' });
  });
  const bytes = new Uint8Array([0, 1, 127, 255]);
  for (const [encoding, author] of [['image/png', agent], ['font/woff2', new Agent(forumSession)]]) {
    await author.com.atproto.repo.uploadBlob(bytes, { encoding });
    const call = f.calls.at(-1);
    assert.deepEqual(call.bytes, bytes);
    assert.equal(call.headers.get('content-type'), encoding);
  }
  await agent.com.atproto.server.getServiceAuth({
    aud: RELAY, lxm: 'pub.atmo.notify.requestPermission', exp: Math.floor(Date.now() / 1000) + 60,
  });
  const call = f.calls.at(-1);
  assert.equal(call.method, 'GET');
  assert.equal(new URL(call.url).searchParams.get('aud'), RELAY);
  assert.equal(new URL(call.url).searchParams.get('lxm'), 'pub.atmo.notify.requestPermission');
});

test('forum reconnection carries extension scopes without modifying member scopes', async () => {
  const f = await fixture();
  await f.login();
  await f.login('forum.test', FORUM_SCOPE);
  const oldForum = JSON.parse(await f.storage.get(`happyview:session:${FORUM}`));
  const member = await f.storage.get(`happyview:session:${MEMBER}`);
  await f.login('forum.test', `${FORUM_SCOPE} repo:com.example.extension.score`);
  const newForum = JSON.parse(await f.storage.get(`happyview:session:${FORUM}`));
  assert.notEqual(newForum.accessToken, oldForum.accessToken);
  assert.notEqual(thumbprint(newForum.dpopKey), thumbprint(oldForum.dpopKey));
  const retired = f.calls.filter((c) => c.method === 'DELETE');
  assert.equal(retired.length, 1);
  assert.equal(retired[0].url, `${HV}/oauth/sessions/${FORUM}`);
  assert.equal(retired[0].headers.get('authorization'), `DPoP ${oldForum.accessToken}`);
  assert.equal(await f.storage.get(`happyview:session:${MEMBER}`), member);
  assert.equal((await f.client.restore(MEMBER)).getTokenInfo().scope, MEMBER_SCOPE);
  const restored = await f.makeClient().restore(FORUM);
  assert.equal(restored.getTokenInfo().scope, `${FORUM_SCOPE} repo:com.example.extension.score`);
  f.respond(() => json({ token: 'synthetic-service-auth' }));
  await new Agent(restored).com.atproto.server.getServiceAuth({ aud: RELAY });
  assert.equal(f.calls.at(-1).headers.get('authorization'), `DPoP ${newForum.accessToken}`);
});

test('HV nonce challenge retries once with a fresh valid proof', async () => {
  const f = await fixture();
  const { session } = await f.login();
  let count = 0;
  f.respond(() => ++count === 1
    ? json({ error: 'use_dpop_nonce' }, 401, { 'dpop-nonce': 'hv-nonce' })
    : json({ token: 'synthetic-service-auth' }));
  await new Agent(session).com.atproto.server.getServiceAuth({ aud: RELAY });
  const requests = f.calls.filter((c) => c.url.includes('/xrpc/'));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].proof.nonce, 'hv-nonce');
  assert.notEqual(requests[0].proof.jti, requests[1].proof.jti);
});

test('an expired/rejected HV credential does not refresh in the SDK or fall back to direct PDS', async () => {
  const f = await fixture();
  await f.login();
  const before = f.calls.length;
  f.respond(() => json({ error: 'InvalidToken', message: 'Synthetic expiry' }, 401));
  const session = await f.makeClient().restore(MEMBER);
  await assert.rejects(new Agent(session).com.atproto.server.getServiceAuth({ aud: RELAY }));
  const requests = f.calls.slice(before);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).origin, HV);
});

test('revoking one account removes its local session, not the other account', async () => {
  const f = await fixture();
  await f.login();
  await f.login('forum.test', FORUM_SCOPE);
  await f.client.revoke(MEMBER);
  await assert.rejects(f.client.restore(MEMBER), /No session found/);
  assert.equal((await f.client.restore(FORUM)).did, FORUM);
});

test('unknown/replayed callback state cannot register another session', async () => {
  const f = await fixture();
  await f.login();
  const state = f.pars.at(-1).get('state');
  const before = f.registrations.length;
  for (const candidate of [state, 'unknown']) {
    await assert.rejects(f.client.callback(new URLSearchParams({
      state: candidate, code: 'member.test', iss: ISSUER,
    })), /Unknown authorization session/);
  }
  assert.equal(f.registrations.length, before);
});

test('CHARACTERIZATION: callback accepts a mismatched issuer without checking it locally', async () => {
  const f = await fixture();
  await f.client.authorize('member.test', { scope: MEMBER_SCOPE });
  await f.client.callback(new URLSearchParams({
    state: f.pars.at(-1).get('state'), code: 'member.test', iss: 'https://wrong-issuer.example.test',
  }));
  assert.equal(f.registrations.length, 1);
  // The synthetic token service still returns the expected account. This proves
  // missing client-side issuer validation, not an end-to-end account takeover.
});

test('CHARACTERIZATION: caller-supplied state is the OAuth lookup key, not separate application state', async () => {
  const f = await fixture();
  const state = `forum-connect:${MEMBER}`;
  await f.client.authorize('forum.test', { scope: FORUM_SCOPE, state });
  const first = await f.storage.get(`pending-auth:${state}`);
  await f.client.authorize('forum.test', { scope: FORUM_SCOPE, state });
  assert.equal(f.pars[0].get('state'), state);
  assert.equal(f.pars[1].get('state'), state);
  assert.notEqual(await f.storage.get(`pending-auth:${state}`), first);
});

test('CHARACTERIZATION: omitted token scope falls back to client-wide scope, not per-login scope', async () => {
  const f = await fixture();
  f.setTokenScopes(null);
  const { session } = await f.login();
  assert.equal(f.pars.at(-1).get('scope'), MEMBER_SCOPE);
  assert.equal(session.getTokenInfo().scope, `${MEMBER_SCOPE} ${FORUM_SCOPE}`);
  // This does not prove the PDS granted these scopes; it exposes incorrect SDK metadata.
});

test('CHARACTERIZATION: PAR nonce challenge is not retried by the Node SDK', async () => {
  const f = await fixture();
  f.challengePar();
  await assert.rejects(f.client.authorize('member.test', { scope: MEMBER_SCOPE }), /PAR request failed/);
  assert.equal(f.pars.length, 1);
});

test('file-backed SDK session restores in a fresh Node process; no refresh token is stored locally', async () => {
  // Synthetic credentials only. Default location is already ignored by the repository.
  const root = process.env.DELTA_SCRATCH_DIR ?? join(import.meta.dirname, 'node_modules', '.cache');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'happyview-oauth-trial-'));
  const storage = {
    get: async (name) => {
      try { return await readFile(join(directory, encodeURIComponent(name)), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    set: (name, value) => writeFile(join(directory, encodeURIComponent(name)), value, { mode: 0o600 }),
    delete: async (name) => {
      assert.ok(name.startsWith('pending-auth'), 'Only synthetic pending OAuth state may be deleted');
      await unlink(join(directory, encodeURIComponent(name)));
    },
  };
  const f = await fixture(storage);
  await f.login('forum.test', FORUM_SCOPE);
  const stored = JSON.parse(await storage.get(`happyview:session:${FORUM}`));
  assert.ok(stored.dpopKey.d);
  assert.ok(stored.accessToken);
  assert.equal(stored.refreshToken, undefined);
  const child = spawnSync(process.execPath, ['restore-worker.mjs', directory, FORUM], {
    cwd: import.meta.dirname, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { did: FORUM, destination: HV, method: 'GET' });
});
