import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The names endpoint over the real registry on disk. The seams are the
// extensions lock and the source resolver's network, which name lookups share:
// DID documents, DNS TXT lookups, and the hardened fetcher.

const APP = 'https://forum.test';
const INSTALL = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER_INSTALL = 'CCCCCCCCCCCCCCCCCCCCCC';
const FORUM = 'did:plc:atmobbdevforum';
const KEITH = 'did:plc:5qartdsce62n2wfyvtocmoob';
const JACK = 'did:plc:dvh42fok55dox6pzlyevelz6';
const PDS = 'https://pds.example.test';
const CLIENT = '203.0.113.9';

const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, lockHeld: true }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/extensions/lock', () => ({ extensionsLockHeld: () => state.lockHeld }));

import { MAX_NAME_DIDS, MAX_NAME_HANDLES } from '$lib/extensions/bridge';
import { NAMES_ANSWER_MS, NAME_LOOKUPS_PER_CLIENT_PER_MINUTE, resetNamesForTests } from '$lib/server/extensions/names';
import { resetSourceForTests, setSourceDepsForTests } from '$lib/server/extensions/source';
import { resetRegistryCacheForTests } from '$lib/server/extensions/registry';
import { GET } from './+server';

const encode = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

interface Account {
  handle?: string;
  /** How the handle resolves: a DNS TXT DID, a well-known DID, or nothing. */
  txt?: string;
  wellKnown?: string;
  profile?: unknown;
  /** Never answer the DID document. */
  hang?: boolean;
}

let accounts: Record<string, Account>;
let deps: { resolveDidDocument: ReturnType<typeof vi.fn>; resolveTxt: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> };

function network() {
  const byHandle = (handle: string) => Object.values(accounts).find((account) => account.handle === handle);
  return {
    resolveDidDocument: vi.fn(async (did: string) => {
      const account = accounts[did];
      if (!account) throw new Error('DidDocumentFetchFailed');
      if (account.hang) return new Promise(() => {});
      return {
        id: did,
        alsoKnownAs: account.handle ? [`at://${account.handle}`] : [],
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
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
        return wellKnown ? { status: 200, headers: {}, body: encode(wellKnown) } : { status: 404, headers: {}, body: encode('') };
      }
      if (parsed.pathname === '/xrpc/com.atproto.repo.getRecord') {
        const repo = parsed.searchParams.get('repo')!;
        expect(parsed.searchParams.get('collection')).toBe('app.atmobb.actor.profile');
        const profile = accounts[repo]?.profile;
        if (profile instanceof Error) throw profile;
        if (!profile) return { status: 400, headers: {}, body: encode({ error: 'RecordNotFound' }) };
        return { status: 200, headers: {}, body: encode({ uri: `at://${repo}/app.atmobb.actor.profile/self`, cid: 'bafy', value: profile }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  };
}

let directory: string;

async function writeInstall(installState: 'active' | 'disabled' = 'active') {
  await mkdir(join(directory, 'extensions'), { recursive: true });
  const install = (id: string) => ({ id, sha: 'abc', normalizedUrl: `https://git.example/jack/${id}`, state: installState, manifest: { name: 'Diplomacy', collections: [], ui: { entry: 'ui/index.html' } } });
  await writeFile(join(directory, 'extensions', 'registry.json'), JSON.stringify({ installs: [install(INSTALL), install(OTHER_INSTALL)] }));
  resetRegistryCacheForTests();
}

async function lookup({ dids = [], handles = [], install = INSTALL, client = CLIENT }: { dids?: string[]; handles?: string[]; install?: string; client?: string } = {}) {
  const url = new URL(`${APP}/x/${install}/names`);
  for (const did of dids) url.searchParams.append('did', did);
  for (const handle of handles) url.searchParams.append('handle', handle);
  const event = { url, params: { install }, request: new Request(url), locals: { user: null }, getClientAddress: () => client };
  const response = await GET(event as never);
  return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-names-test-'));
  vi.stubEnv('DATA_DIR', directory);
  state.lockHeld = true;
  await writeInstall();
  resetSourceForTests();
  resetNamesForTests();
  accounts = {
    [KEITH]: { handle: 'keith.is', wellKnown: KEITH, profile: { $type: 'app.atmobb.actor.profile', displayName: '  Keith  ' } },
    [JACK]: { handle: 'jack.example.com', txt: JACK },
  };
  deps = network();
  setSourceDepsForTests(deps as never);
});
afterEach(async () => {
  vi.useRealTimers();
  resetSourceForTests();
  resetNamesForTests();
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

describe('GET /x/[install]/names', () => {
  it('names each DID by its verified handle and display name', async () => {
    expect(await lookup({ dids: [KEITH, JACK] })).toEqual({
      status: 200,
      cacheControl: 'private, max-age=60',
      body: { names: { [KEITH]: { handle: 'keith.is', displayName: 'Keith' }, [JACK]: { handle: 'jack.example.com' } }, dids: {} },
    });
  });

  it("uses the display name this forum's override gives", async () => {
    state.env.ATMOBB_FORUM_DID = FORUM;
    accounts[KEITH].profile = { displayName: 'Keith', forumProfiles: [{ forum: FORUM, fields: ['displayName'], displayName: 'Keith (GM)' }] };
    expect((await lookup({ dids: [KEITH] })).body.names[KEITH]).toEqual({ handle: 'keith.is', displayName: 'Keith (GM)' });
  });

  it('answers null, uncached, for a handle that resolves to another DID or not at all, or a DID it can’t read', async () => {
    accounts[JACK].txt = KEITH;
    accounts[KEITH].wellKnown = undefined;
    expect(await lookup({ dids: [KEITH, JACK, 'did:plc:nobodyhome'] })).toEqual({
      status: 200,
      cacheControl: 'private, no-store',
      body: { names: { [KEITH]: null, [JACK]: null, 'did:plc:nobodyhome': null }, dids: {} },
    });
  });

  it('keeps the handle when the profile has no display name or can’t be read', async () => {
    accounts[KEITH].profile = new Error('Timeout');
    expect((await lookup({ dids: [KEITH] })).body.names[KEITH]).toEqual({ handle: 'keith.is' });
  });

  it('finds the DID a handle verifiably belongs to, with or without its @, keyed as asked', async () => {
    expect((await lookup({ handles: ['@Keith.is', 'keith.is', 'nobody.example.com'] })).body).toEqual({
      names: {},
      dids: { '@Keith.is': KEITH, 'keith.is': KEITH, 'nobody.example.com': null },
    });

    // The handle resolves to a DID whose document claims some other handle.
    accounts[KEITH].handle = 'someone.else';
    accounts.claimed = { handle: 'keith.is', wellKnown: KEITH };
    resetNamesForTests();
    expect((await lookup({ handles: ['keith.is'] })).body.dids).toEqual({ 'keith.is': null });
  });

  it('answers with what finished when a lookup is too slow, rather than failing', async () => {
    accounts[JACK].hang = true;
    // Only the answer's deadline is faked; the registry still reads from disk.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const answer = lookup({ dids: [KEITH, JACK] });
    await vi.waitFor(() => expect(deps.resolveDidDocument).toHaveBeenCalledWith(JACK));
    await vi.advanceTimersByTimeAsync(NAMES_ANSWER_MS);
    expect(await answer).toMatchObject({
      status: 200,
      cacheControl: 'private, no-store',
      body: { names: { [KEITH]: { handle: 'keith.is', displayName: 'Keith' }, [JACK]: null } },
    });
  });

  it('answers repeat lookups from its cache', async () => {
    await lookup({ dids: [KEITH], handles: ['keith.is'] });
    const calls = deps.resolveDidDocument.mock.calls.length;
    await lookup({ dids: [KEITH], handles: ['@keith.is'], client: '198.51.100.4' });
    expect(deps.resolveDidDocument).toHaveBeenCalledTimes(calls);
  });

  it('refuses too many or malformed DIDs and handles, an empty ask, an inactive install, and while extensions are off', async () => {
    const many = (count: number, make: (i: number) => string) => Array.from({ length: count }, (_, i) => make(i));
    expect((await lookup({ dids: many(MAX_NAME_DIDS, (i) => `did:plc:person${i}`), handles: many(MAX_NAME_HANDLES, (i) => `p${i}.example.com`) })).status).toBe(200);
    expect(await lookup({ dids: many(MAX_NAME_DIDS + 1, (i) => `did:plc:person${i}`) })).toMatchObject({ status: 400, cacheControl: 'private, no-store', body: { code: 'bad_request' } });
    expect(await lookup({ handles: many(MAX_NAME_HANDLES + 1, (i) => `p${i}.example.com`) })).toMatchObject({ status: 400, body: { code: 'bad_request' } });
    expect(await lookup()).toMatchObject({ status: 400, body: { code: 'bad_request' } });
    expect(await lookup({ dids: ['keith.is'] })).toMatchObject({ status: 400, body: { code: 'bad_request' } });
    expect(await lookup({ handles: ['did:plc:abc'] })).toMatchObject({ status: 400, body: { code: 'bad_request' } });
    expect(await lookup({ handles: ['not a handle'] })).toMatchObject({ status: 400, body: { code: 'bad_request' } });
    expect(await lookup({ handles: ['@@keith.is'] })).toMatchObject({ status: 400, body: { code: 'bad_request' } });

    expect(await lookup({ dids: [KEITH], install: 'BBBBBBBBBBBBBBBBBBBBBB' })).toMatchObject({ status: 404, body: { code: 'not_installed' } });
    await writeInstall('disabled');
    expect(await lookup({ dids: [KEITH] })).toMatchObject({ status: 404, body: { code: 'not_installed' } });
    await writeInstall();
    state.lockHeld = false;
    expect(await lookup({ dids: [KEITH] })).toMatchObject({ status: 503, body: { code: 'unavailable' } });
    state.lockHeld = true;
    state.env.ATMOBB_EXTENSIONS = 'off';
    expect(await lookup({ dids: [KEITH] })).toMatchObject({ status: 503, body: { code: 'unavailable' } });
    expect(deps.resolveDidDocument).not.toHaveBeenCalledWith(KEITH);
  });

  it('limits lookups per install and client address', async () => {
    for (let i = 0; i < NAME_LOOKUPS_PER_CLIENT_PER_MINUTE; i++) expect((await lookup({ dids: [KEITH] })).status).toBe(200);
    expect(await lookup({ dids: [KEITH] })).toMatchObject({ status: 429, cacheControl: 'private, no-store', body: { code: 'rate_limited' } });
    expect((await lookup({ dids: [KEITH], client: '198.51.100.4' })).status).toBe(200);
    expect((await lookup({ dids: [KEITH], install: OTHER_INSTALL })).status).toBe(200);
  });
});
