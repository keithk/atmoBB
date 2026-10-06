import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { Cookies } from '@sveltejs/kit';
import { Agent } from '@atproto/api';
import { AtprotoDohHandleResolver, DidResolverCommon } from '@happyview/oauth-client-node';
import { FLOW_COOKIE, FLOW_TTL, SecureHappyViewOAuth, type OAuthContext } from './happyview-oauth';
import { HappyViewStorage } from './happyview-storage';
import { resetOutboundForTests, setRequestFnForTests, setResolverForTests } from './extensions/outbound';

const HV = 'https://hv.example';
const PDS = 'https://pds.example';
const AS = 'https://auth.example';
const MEMBER = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const FORUM = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const scope = 'atproto include:app.atmobb.authForum blob:image/*';
let directory: string;

function browser() {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn((name: string) => values.get(name)),
    set: vi.fn((name: string, value: string) => { values.set(name, value); }),
    delete: vi.fn((name: string) => { values.delete(name); }),
  } as unknown as Cookies & { values: Map<string, string> };
}

async function fixture() {
  let pair: webcrypto.CryptoKeyPair;
  let jwk: JsonWebKey;
  const calls: Request[] = [];
  const pars: URLSearchParams[] = [];
  const registrations: Record<string, unknown>[] = [];
  const controls = { nonce: 'none', tokenDid: undefined as string | null | undefined, tokenScope: undefined as string | null | undefined,
    registeredScopes: undefined as string[] | undefined,
    forumDid: FORUM,
    tokenIssuer: AS, issuer: AS, registrationDid: undefined as string | undefined, provisionNonce: false };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    calls.push(req.clone());
    expect(req.redirect).toBe('error');
    expect(req.headers.has('cookie')).toBe(false);
    if (new URL(req.url).origin === HV) expect(req.headers.get('origin')).toBe('https://forum.example');
    else {
      expect(req.headers.has('origin')).toBe(false);
      expect(req.headers.has('x-client-key')).toBe(false);
      expect(req.headers.has('authorization')).toBe(false);
    }
    if (req.url === `${PDS}/.well-known/oauth-protected-resource`) {
      return Response.json({ resource: PDS, authorization_servers: [AS] });
    }
    if (req.url === `${AS}/.well-known/oauth-authorization-server`) {
      return Response.json({ issuer: controls.issuer, token_endpoint: `${AS}/token`,
        authorization_endpoint: `${AS}/authorize`, pushed_authorization_request_endpoint: `${AS}/par` });
    }
    if (req.url === `${HV}/oauth/dpop-keys`) {
      if (controls.provisionNonce) return Response.json({ error: 'use_dpop_nonce' }, { status: 400, headers: { 'dpop-nonce': 'unrelated' } });
      pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const { kty, crv, x, y, d } = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
      jwk = { kty, crv, x, y, d };
      return Response.json({ provision_id: 'synthetic-provision', dpop_key: jwk, confidential: false });
    }
    if (req.url === `${AS}/par`) {
      pars.push(new URLSearchParams(await req.text()));
      if (controls.nonce === 'always' || (controls.nonce === 'once' && !req.headers.has('dpop'))) {
        return Response.json({ error: 'use_dpop_nonce' }, { status: 400, headers: { 'dpop-nonce': 'nonce-1' } });
      }
      if (controls.nonce === 'once') {
        const [header, payload, signature] = req.headers.get('dpop')!.split('.');
        expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({ typ: 'dpop+jwt', jwk: { x: jwk.x, y: jwk.y } });
        expect(JSON.parse(Buffer.from(header, 'base64url').toString()).jwk.d).toBeUndefined();
        expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ htu: `${AS}/par`, htm: 'POST', nonce: 'nonce-1' });
        expect(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey,
          Buffer.from(signature, 'base64url'), Buffer.from(`${header}.${payload}`))).toBe(true);
      }
      return Response.json({ request_uri: `urn:test:${pars.length}`, expires_in: 90 });
    }
    if (req.url === `${AS}/token`) {
      const form = new URLSearchParams(await req.text());
      const did = form.get('code') === 'forum.test' ? FORUM : MEMBER;
      return Response.json({ access_token: `token-${did}`, refresh_token: 'refresh', token_type: 'DPoP',
        ...(controls.tokenDid === null ? {} : { sub: controls.tokenDid ?? did }), iss: controls.tokenIssuer,
        ...(controls.tokenScope === null ? {} : { scope: controls.tokenScope ?? pars.at(-1)!.get('scope') }) });
    }
    if (req.url === `${HV}/oauth/sessions` && req.method === 'POST') {
      const body = await req.json();
      registrations.push(body);
      return Response.json({ did: controls.registrationDid ?? body.did, scopes: controls.registeredScopes ?? body.scopes.split(' ') });
    }
    if (req.url.startsWith(`${HV}/oauth/sessions/`) && req.method === 'DELETE') return Response.json({});
    if (req.url.startsWith(`${HV}/xrpc/`)) return Response.json({ records: [], cursor: undefined });
    throw new Error(`Unexpected network request: ${req.method} ${req.url}`);
  };
  const options = { instanceUrl: HV, appUrl: 'https://forum.example', clientId: 'https://forum.example/oauth-client-metadata.json',
    clientKey: 'public-client', redirectUri: 'https://forum.example/oauth/callback', dataDir: directory, forumDid: () => controls.forumDid, fetch };
  const create = (override: Partial<typeof options> = {}) => new SecureHappyViewOAuth({ ...options, ...override });
  const client = create();
  const cookies = browser();
  const begin = async (handle = 'member.test', context: OAuthContext = { purpose: 'member', next: '/notifications' }, requestedScope = scope) => {
    await client.authorize(handle, { scope: requestedScope, context, cookies });
    return new URLSearchParams({ state: pars.at(-1)!.get('state')!, code: handle, iss: AS });
  };
  return { client, create, cookies, begin, calls, pars, registrations, controls };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-hv-test-'));
  vi.spyOn(AtprotoDohHandleResolver.prototype, 'resolve').mockImplementation(async (handle) => {
    if (handle === 'member.test') return MEMBER;
    if (handle === 'forum.test') return FORUM;
    throw new Error('Unexpected handle');
  });
  vi.spyOn(DidResolverCommon.prototype, 'resolve').mockImplementation(async (did) => ({
    id: did === FORUM ? FORUM : MEMBER, alsoKnownAs: [`at://${did === FORUM ? 'forum.test' : 'member.test'}`],
    service: [{ id: `${did}#atproto_pds`, type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
  }));
});
afterEach(async () => {
  resetOutboundForTests();
  vi.restoreAllMocks();
  await rm(directory, { force: true, recursive: true });
});

describe('HappyView browser transactions with the published SDK', () => {
  it('pins the validated identity instead of resolving a different DID document inside authorize', async () => {
    const f = await fixture();
    await f.client.callback(await f.begin(), f.cookies, null);
    expect(DidResolverCommon.prototype.resolve).toHaveBeenCalledTimes(1);
    expect(AtprotoDohHandleResolver.prototype.resolve).toHaveBeenCalledTimes(1);
  });

  it('does not let the SDK loose service suffix select an unvalidated HTTP endpoint', async () => {
    vi.mocked(DidResolverCommon.prototype.resolve).mockResolvedValue({
      id: MEMBER, alsoKnownAs: ['at://member.test'],
      service: [
        { id: 'did:plc:attacker#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'http://127.0.0.1/private' },
        { id: `${MEMBER}#atproto_pds`, type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS },
      ],
    });
    const f = await fixture();
    await f.client.callback(await f.begin(), f.cookies, null);
    expect(f.calls.some((request) => request.url.includes('127.0.0.1'))).toBe(false);
  });

  it('normalizes the validated PDS service consistently when it ends in a slash', async () => {
    vi.mocked(DidResolverCommon.prototype.resolve).mockResolvedValue({
      id: MEMBER, alsoKnownAs: ['at://member.test'],
      service: [{ id: `${MEMBER}#atproto_pds`, type: 'AtprotoPersonalDataServer', serviceEndpoint: `${PDS}/` }],
    });
    const f = await fixture();
    await f.client.callback(await f.begin(), f.cookies, null);
    expect(f.registrations[0].pds_url).toBe(PDS);
  });

  it('rejects a private DNS destination before opening any production connection', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network call'));
    const connection = vi.fn(() => { throw new Error('Unexpected connection'); });
    setRequestFnForTests(connection);
    setResolverForTests(async () => [{ address: '10.0.0.5', family: 4 }]);
    const f = await fixture();
    await expect(f.create({ fetch: undefined }).authorize('member.test', {
      scope, cookies: f.cookies, context: { purpose: 'member' },
    })).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
  });

  it('uses opaque unique state, an HttpOnly binding, and consumes callbacks across adapter restart', async () => {
    const f = await fixture();
    const params = await f.begin();
    expect(params.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('state')).not.toContain('notifications');
    expect(f.cookies.set).toHaveBeenCalledWith(FLOW_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: true, maxAge: 600 }));
    const result = await f.create().callback(params, f.cookies, null);
    expect(result.context).toEqual({ purpose: 'member', next: '/notifications' });
    expect(result.session.did).toBe(MEMBER);
    await expect(f.client.callback(params, f.cookies, null)).rejects.toThrow('already used');
    expect((await f.begin()).get('state')).not.toBe(params.get('state'));
  });

  it('rejects cross-browser callbacks without exchanging or consuming the legitimate flow', async () => {
    const f = await fixture();
    const params = await f.begin();
    await expect(f.client.callback(params, browser(), null)).rejects.toThrow('another browser');
    expect(f.registrations).toHaveLength(0);
    expect(f.calls.some((r) => r.url.endsWith('/token'))).toBe(false);
    await f.client.callback(params, f.cookies, null);
  });

  it('rejects expired state and duplicate callback parameters', async () => {
    const f = await fixture();
    const params = await f.begin();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + FLOW_TTL + 1);
    await expect(f.client.callback(params, f.cookies, null)).rejects.toThrow('expired');
    params.append('iss', AS);
    await expect(f.client.callback(params, f.cookies, null)).rejects.toThrow('Duplicate');
    expect(f.registrations).toHaveLength(0);
  });

  it.each(['https://wrong.example', ''])('rejects issuer %s before token exchange and consumes it', async (issuer) => {
    const f = await fixture();
    const params = await f.begin();
    params.set('iss', issuer);
    await expect(f.client.callback(params, f.cookies, null)).rejects.toThrow('issuer mismatch');
    expect(f.calls.some((r) => r.url.endsWith('/token'))).toBe(false);
    await expect(f.client.callback(params, f.cookies, null)).rejects.toThrow('already used');
  });

  it('rejects a discovery issuer mismatch before PAR', async () => {
    const f = await fixture();
    f.controls.issuer = 'https://wrong.example';
    await expect(f.begin()).rejects.toThrow('issuer mismatch');
    expect(f.pars).toHaveLength(0);
  });

  it('rejects wrong token account before registration and preserves an existing session', async () => {
    const f = await fixture();
    await f.client.callback(await f.begin(), f.cookies, null);
    const params = await f.begin();
    f.controls.tokenDid = FORUM;
    await expect(f.client.callback(params, f.cookies, null)).rejects.toThrow('identity');
    expect(f.registrations).toHaveLength(1);
    expect((await f.create().restore(MEMBER)).did).toBe(MEMBER);
  });

  it('rejects a token without a subject before registration', async () => {
    const f = await fixture();
    f.controls.tokenDid = null;
    await expect(f.client.callback(await f.begin(), f.cookies, null)).rejects.toThrow('identity');
    expect(f.registrations).toHaveLength(0);
  });

  it('rejects wrong token issuer and wrong HappyView registration identity', async () => {
    const f = await fixture();
    f.controls.tokenIssuer = 'https://wrong.example';
    await expect(f.client.callback(await f.begin(), f.cookies, null)).rejects.toThrow('identity');
    expect(f.registrations).toHaveLength(0);
    f.controls.tokenIssuer = AS;
    f.controls.registrationDid = FORUM;
    await expect(f.client.callback(await f.begin(), f.cookies, null)).rejects.toThrow('different account');
    await expect(f.client.restore(FORUM)).rejects.toThrow();
  });

  it('uses only requested scope when omitted, while retaining explicitly expanded scope', async () => {
    const f = await fixture();
    f.controls.tokenScope = null;
    const { session } = await f.client.callback(await f.begin(), f.cookies, null);
    expect(session.getTokenInfo().scope).toBe(scope);
    expect(f.registrations[0].scopes).toBe(scope);
    f.controls.tokenScope = 'atproto repo:app.atmobb.discussion.post?action=create blob:image/*';
    const expanded = await f.client.callback(await f.begin(), f.cookies, null);
    expect(expanded.session.getTokenInfo().scope).toBe(f.controls.tokenScope);
  });

  it('stores and returns the actual HappyView registered scopes when they differ', async () => {
    const f = await fixture();
    f.controls.registeredScopes = ['atproto'];
    const result = await f.client.callback(await f.begin(), f.cookies, null);
    expect(result.session.getTokenInfo().scope).toBe('atproto');
    expect((await f.create().restore(MEMBER)).getTokenInfo().scope).toBe('atproto');
    expect(f.registrations[0].scopes).toBe(scope);
  });

  it('requires the same personal user and the configured forum before registration', async () => {
    const f = await fixture();
    const context = { purpose: 'forum', connector: MEMBER, forumDid: FORUM } as const;
    await expect(f.begin('member.test', context)).rejects.toThrow('configured forum');
    const params = await f.begin('forum.test', context, 'atproto include:app.atmobb.authSysop');
    await expect(f.client.callback(params, f.cookies, null)).rejects.toThrow('initiating user');
    await expect(f.client.callback(params, f.cookies, FORUM)).rejects.toThrow('initiating user');
    expect(f.registrations).toHaveLength(0);
    const result = await f.client.callback(params, f.cookies, MEMBER);
    expect(result.session.did).toBe(FORUM);
    expect(result.context).toEqual(context);
  });

  it('rejects changed forum configuration before registration', async () => {
    const f = await fixture();
    const params = await f.begin('forum.test', { purpose: 'forum', connector: MEMBER, forumDid: FORUM });
    f.controls.forumDid = MEMBER;
    await expect(f.client.callback(params, f.cookies, MEMBER)).rejects.toThrow('initiating user or forum');
    expect(f.registrations).toHaveLength(0);
  });

  it('rejects changed OAuth client configuration before token exchange', async () => {
    const f = await fixture();
    const params = await f.begin();
    await expect(f.create({ clientKey: 'other-public-client' }).callback(params, f.cookies, null)).rejects.toThrow('configuration changed');
    expect(f.calls.some((r) => r.url.endsWith('/token'))).toBe(false);
  });

  it('consumes cancellation without registering or allowing replay', async () => {
    const f = await fixture();
    const params = await f.begin();
    params.delete('code');
    params.set('error', 'access_denied');
    await expect(f.client.callback(params, f.cookies, null)).rejects.toThrow();
    await expect(f.client.callback(params, f.cookies, null)).rejects.toThrow('already used');
    expect(f.registrations).toHaveLength(0);
  });

  it('retries a PAR DPoP nonce once with a real signed proof', async () => {
    const f = await fixture();
    f.controls.nonce = 'once';
    await f.client.callback(await f.begin(), f.cookies, null);
    expect(f.pars).toHaveLength(2);
    expect(f.pars[0].toString()).toBe(f.pars[1].toString());
  });

  it('bounds PAR retries and never retries unrelated nonce responses', async () => {
    const f = await fixture();
    f.controls.nonce = 'always';
    await expect(f.begin()).rejects.toThrow('PAR request failed');
    expect(f.pars).toHaveLength(2);
    f.controls.provisionNonce = true;
    const before = f.calls.length;
    await expect(f.begin()).rejects.toThrow();
    expect(f.calls.slice(before).filter((r) => r.url.endsWith('/oauth/dpop-keys'))).toHaveLength(1);
  });

  it('restores Agent traffic through HV and revokes only the selected DID/purpose', async () => {
    const f = await fixture();
    await f.client.callback(await f.begin(), f.cookies, null);
    await f.client.callback(await f.begin('forum.test', { purpose: 'forum', connector: MEMBER, forumDid: FORUM },
      'atproto include:app.atmobb.authSysop'), f.cookies, MEMBER);
    await f.client.callback(await f.begin('forum.test'), f.cookies, null);
    const restored = f.create();
    const agent = new Agent(await restored.restore(MEMBER));
    await agent.com.atproto.repo.listRecords({ repo: MEMBER, collection: 'app.atmobb.discussion.post' });
    const request = f.calls.at(-1)!;
    expect(request.url).toContain(`${HV}/xrpc/com.atproto.repo.listRecords`);
    expect(request.headers.get('authorization')).toBe(`DPoP token-${MEMBER}`);
    await restored.revoke(FORUM, 'member');
    expect((await restored.restore(FORUM, false, 'forum')).did).toBe(FORUM);
    expect((await restored.restore(MEMBER)).did).toBe(MEMBER);
    await expect(restored.restore(FORUM, false, 'member')).rejects.toThrow();
    await expect(restored.fetch(MEMBER, 'https://attacker.example/xrpc/test')).rejects.toThrow('external URL');
    await expect((await restored.restore(MEMBER)).fetchHandler('https://attacker.example/steal', {})).rejects.toThrow('Refusing');
    expect(f.calls.some((r) => r.url.includes('attacker.example'))).toBe(false);
  });

  it('allows at most one concurrent callback to register', async () => {
    const f = await fixture();
    const params = await f.begin();
    const results = await Promise.allSettled([
      f.client.callback(params, f.cookies, null), f.create().callback(params, f.cookies, null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.registrations).toHaveLength(1);
  });

  it('restores credentials in a fresh process and makes an Agent request to HappyView', async () => {
    const f = await fixture();
    await f.client.callback(await f.begin(), f.cookies, null);
    const script = `
      import { SecureHappyViewOAuth } from ${JSON.stringify(join(process.cwd(), 'src/lib/server/happyview-oauth.ts'))};
      import { Agent } from '@atproto/api';
      const client = new SecureHappyViewOAuth({
        instanceUrl: ${JSON.stringify(HV)}, appUrl: 'https://forum.example',
        clientId: 'https://forum.example/oauth-client-metadata.json', clientKey: 'public-client',
        redirectUri: 'https://forum.example/oauth/callback', dataDir: ${JSON.stringify(directory)}, forumDid: () => ${JSON.stringify(FORUM)},
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (!request.url.startsWith(${JSON.stringify(HV + '/xrpc/')})) throw new Error('unexpected URL');
          if (!request.headers.has('dpop') || !request.headers.has('authorization')) throw new Error('missing auth');
          console.log(JSON.stringify({ url: request.url }));
          return Response.json({ records: [] });
        },
      });
      const session = await client.restore(${JSON.stringify(MEMBER)});
      await new Agent(session).com.atproto.repo.listRecords({ repo: session.did, collection: 'app.atmobb.discussion.post' });
    `;
    const child = spawnSync('bun', ['--eval', script], { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 });
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout).url).toContain(`${HV}/xrpc/com.atproto.repo.listRecords`);
  });
});

describe('private atomic credential storage', () => {
  it('restricts modes, uses opaque filenames, persists restart, and atomically consumes values', async () => {
    const path = join(directory, 'credentials');
    const storage = new HappyViewStorage(path);
    await storage.set('../../did:plc:member', 'private');
    const files = await readdir(path);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect((await stat(path)).mode & 0o777).toBe(0o700);
    expect((await stat(join(path, files[0]))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(path, files[0]), 'utf8')).toBe('private');
    expect(await new HappyViewStorage(path).get('../../did:plc:member')).toBe('private');
    expect(await Promise.all([storage.take('../../did:plc:member'), storage.take('../../did:plc:member')])).toEqual(['private', null]);
    expect(await readdir(path)).toEqual([]);
  });
});
