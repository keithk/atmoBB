import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The source endpoint over the real registry on disk. The seams are the
// extensions lock and the source resolver's network: DID documents, DNS TXT
// lookups, and the hardened fetcher.

const APP = 'https://forum.test';
const INSTALL = 'AAAAAAAAAAAAAAAAAAAAAA';
const FORUM = 'did:plc:dvh42fok55dox6pzlyevelz6';
const PLAYER = 'did:plc:5qartdsce62n2wfyvtocmoob';
const PDS = 'https://pds.example.test';
const CLIENT = '203.0.113.9';

const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, lockHeld: true }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/extensions/lock', () => ({ extensionsLockHeld: () => state.lockHeld }));

import { SOURCE_LOOKUPS_PER_CLIENT_PER_MINUTE, resetSourceForTests, setSourceDepsForTests } from '$lib/server/extensions/source';
import { GET } from './+server';

const encode = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

interface Account {
  handle?: string;
  pds?: string | null;
  profile?: unknown;
  /** How the handle resolves: a DNS TXT DID, a well-known DID, or nothing. */
  txt?: string;
  wellKnown?: string;
}

let accounts: Record<string, Account>;
let deps: { resolveDidDocument: ReturnType<typeof vi.fn>; resolveTxt: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> };

function network() {
  const byHandle = (handle: string) => Object.values(accounts).find((account) => account.handle === handle);
  return {
    resolveDidDocument: vi.fn(async (did: string) => {
      const account = accounts[did];
      if (!account) throw new Error('DidDocumentFetchFailed');
      return {
        id: did,
        alsoKnownAs: account.handle ? [`at://${account.handle}`] : [],
        service: account.pds === null ? [] : [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: account.pds ?? PDS }],
      };
    }),
    resolveTxt: vi.fn(async (hostname: string) => {
      const txt = byHandle(hostname.replace(/^_atproto\./, ''))?.txt;
      if (!txt) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
      return [[`did=${txt}`]];
    }),
    fetch: vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/.well-known/atproto-did') {
        const wellKnown = byHandle(parsed.hostname)?.wellKnown;
        return wellKnown ? { status: 200, headers: {}, body: encode(`${wellKnown}\n`) } : { status: 404, headers: {}, body: encode('') };
      }
      if (parsed.pathname === '/xrpc/com.atproto.repo.getRecord') {
        const repo = parsed.searchParams.get('repo')!;
        expect(parsed.searchParams.get('collection')).toBe('app.atmobb.forum.profile');
        expect(parsed.searchParams.get('rkey')).toBe('self');
        const profile = accounts[repo]?.profile;
        if (profile instanceof Error) throw profile;
        if (!profile) return { status: 400, headers: {}, body: encode({ error: 'RecordNotFound', message: 'Could not locate record' }) };
        return { status: 200, headers: {}, body: encode({ uri: `at://${repo}/app.atmobb.forum.profile/self`, cid: 'bafy', value: profile }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  };
}

let directory: string;

async function writeInstall(installState: 'active' | 'disabled' = 'active') {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const install = { id: INSTALL, sha: 'abc', normalizedUrl: 'https://git.example/jack/diplomacy', state: installState, manifest: { name: 'Diplomacy', collections: [], ui: { entry: 'ui/index.html' } } };
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify({ installs: [install] }));
}

async function lookup(did: string | null, { install = INSTALL, client = CLIENT }: { install?: string; client?: string } = {}) {
  const url = new URL(`${APP}/x/${install}/source`);
  if (did !== null) url.searchParams.set('did', did);
  const event = { url, params: { install }, request: new Request(url), locals: { user: null }, getClientAddress: () => client };
  const response = await GET(event as never);
  return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-source-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.lockHeld = true;
  await writeInstall();
  resetSourceForTests();
  accounts = {
    [FORUM]: { handle: 'atmobb.app', txt: FORUM, profile: { $type: 'app.atmobb.forum.profile', name: 'atmoBB Forums' } },
    [PLAYER]: { handle: 'keith.is', wellKnown: PLAYER },
  };
  deps = network();
  setSourceDepsForTests(deps as never);
});
afterEach(async () => {
  resetSourceForTests();
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

describe('GET /x/[install]/source', () => {
  it('names a forum by its verified handle and forum profile', async () => {
    const answer = await lookup(FORUM);
    expect(answer).toEqual({
      status: 200,
      cacheControl: 'private, max-age=60',
      body: { did: FORUM, handle: 'atmobb.app', handleVerified: true, forum: true, forumName: 'atmoBB Forums' },
    });
    expect(deps.fetch).toHaveBeenCalledWith(`${PDS}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(FORUM)}&collection=app.atmobb.forum.profile&rkey=self`, expect.anything());
  });

  it('says a DID without a forum profile is not a forum, verifying its handle over HTTPS when DNS has none', async () => {
    expect((await lookup(PLAYER)).body).toEqual({ did: PLAYER, handle: 'keith.is', handleVerified: true, forum: false });
    expect(deps.fetch).toHaveBeenCalledWith('https://keith.is/.well-known/atproto-did', expect.anything());
  });

  it('leaves a handle unverified when it resolves to another DID, or not at all', async () => {
    accounts[FORUM].txt = PLAYER;
    expect((await lookup(FORUM)).body).toMatchObject({ handle: 'atmobb.app', handleVerified: false, forum: true });
    accounts[PLAYER].wellKnown = undefined;
    expect((await lookup(PLAYER)).body).toMatchObject({ handle: 'keith.is', handleVerified: false });
  });

  it('gives no handle for a DID document without a valid one', async () => {
    accounts[PLAYER].handle = 'not a handle';
    expect((await lookup(PLAYER)).body).toEqual({ did: PLAYER, handle: null, handleVerified: false, forum: false });
  });

  it('falls back safely, and uncached, when the DID document or the PDS fails', async () => {
    const missing = 'did:plc:nobodyhome';
    expect(await lookup(missing)).toEqual({
      status: 200,
      cacheControl: 'private, no-store',
      body: { did: missing, handle: null, handleVerified: false, forum: false, unavailable: true },
    });

    accounts[FORUM].profile = new Error('Timeout');
    expect(await lookup(FORUM)).toEqual({
      status: 200,
      cacheControl: 'private, no-store',
      body: { did: FORUM, handle: 'atmobb.app', handleVerified: true, forum: false, unavailable: true },
    });
  });

  it('says a DID whose document lists no PDS is not a forum', async () => {
    accounts[FORUM].pds = null;
    expect((await lookup(FORUM)).body).toMatchObject({ forum: false });
    expect((await lookup(FORUM)).body.unavailable).toBeUndefined();
  });

  it('does not count a record that is not a forum profile', async () => {
    accounts[FORUM].profile = { $type: 'app.atmobb.forum.profile' };
    const { body } = await lookup(FORUM);
    expect(body).toMatchObject({ forum: false });
    expect(body.unavailable).toBeUndefined();
  });

  it('answers a repeat lookup from its cache', async () => {
    await lookup(FORUM);
    await lookup(FORUM, { client: '198.51.100.4' });
    expect(deps.resolveDidDocument).toHaveBeenCalledOnce();
  });

  it('refuses an install that is not active, a missing or malformed DID, and while extensions are off', async () => {
    expect(await lookup(FORUM, { install: 'BBBBBBBBBBBBBBBBBBBBBB' })).toMatchObject({ status: 404, cacheControl: 'private, no-store', body: { code: 'not_installed' } });
    await writeInstall('disabled');
    expect(await lookup(FORUM)).toMatchObject({ status: 404, body: { code: 'not_installed' } });
    await writeInstall();
    expect(await lookup(null)).toMatchObject({ status: 400, body: { code: 'bad_request' } });
    expect(await lookup('atmobb.app')).toMatchObject({ status: 400, body: { code: 'bad_request' } });
    state.lockHeld = false;
    expect(await lookup(FORUM)).toMatchObject({ status: 503, body: { code: 'unavailable' } });
    state.lockHeld = true;
    state.env.ATMOBB_EXTENSIONS = 'off';
    expect(await lookup(FORUM)).toMatchObject({ status: 503, body: { code: 'unavailable' } });
    expect(deps.resolveDidDocument).not.toHaveBeenCalled();
  });

  it('limits lookups per client address', async () => {
    for (let i = 0; i < SOURCE_LOOKUPS_PER_CLIENT_PER_MINUTE; i++) expect((await lookup(FORUM)).status).toBe(200);
    expect(await lookup(FORUM)).toMatchObject({ status: 429, cacheControl: 'private, no-store', body: { code: 'rate_limited' } });
    expect((await lookup(FORUM, { client: '198.51.100.4' })).status).toBe(200);
  });
});
