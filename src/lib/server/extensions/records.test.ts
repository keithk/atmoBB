import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LexiconDoc } from '@atproto/lexicon';

// Writes and forum-repo reads run through the real forum-repo helpers. The
// seams below are the forum account's OAuth agent (an in-memory repo), the
// dev index's postgres client (an in-memory happyview_records table that
// answers the INSERT/SELECT/DELETE statements forum-repo sends), and the
// hardened fetcher for other repos.

const FORUM = 'did:plc:forumaccount';
const OTHER = 'did:plc:otherforum';

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  repo: new Map<string, { uri: string; cid: string; value: Record<string, unknown> }>(),
  index: new Map<string, { uri: string; cid: string; record: string; collection: string; did: string }>(),
  agentCalls: [] as string[],
  pgCalls: 0,
  writeError: null as unknown,
  resolveDid: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('../appview', () => ({ FORUM_DID: () => state.env.ATMOBB_FORUM_DID ?? 'did:plc:atmobbdevforum' }));

vi.mock('../atproto-oauth', () => {
  let cid = 0;
  const write = (method: string) => async ({ repo, collection, rkey, record }: { repo: string; collection: string; rkey?: string; record: Record<string, unknown> }) => {
    state.agentCalls.push(method);
    if (state.writeError) throw state.writeError;
    const key = rkey ?? `tid${state.repo.size}`;
    const uri = `at://${repo}/${collection}/${key}`;
    if (method === 'createRecord' && state.repo.has(uri)) throw Object.assign(new Error('Record already exists'), { status: 400 });
    const stored = { uri, cid: `bafy${++cid}`, value: record };
    state.repo.set(uri, stored);
    return { data: { uri: stored.uri, cid: stored.cid } };
  };
  return {
    agentFor: async () => ({
      com: {
        atproto: {
          repo: {
            createRecord: write('createRecord'),
            putRecord: write('putRecord'),
            deleteRecord: async ({ repo, collection, rkey }: { repo: string; collection: string; rkey: string }) => {
              state.agentCalls.push('deleteRecord');
              state.repo.delete(`at://${repo}/${collection}/${rkey}`);
            },
            getRecord: async ({ repo, collection, rkey }: { repo: string; collection: string; rkey: string }) => {
              state.agentCalls.push('getRecord');
              const hit = state.repo.get(`at://${repo}/${collection}/${rkey}`);
              if (!hit) throw Object.assign(new Error('Could not locate record'), { status: 400, error: 'RecordNotFound' });
              return { data: hit };
            },
            listRecords: async ({ repo, collection }: { repo: string; collection: string }) => {
              state.agentCalls.push('listRecords');
              const records = [...state.repo.values()].filter((r) => r.uri.startsWith(`at://${repo}/${collection}/`));
              return { data: { records } };
            },
          },
        },
      },
    }),
  };
});

vi.mock('postgres', () => ({
  default: () => {
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.pgCalls++;
      const text = strings.join('?');
      if (text.includes('INSERT INTO happyview_records')) {
        const [uri, did, collection, , record, cid] = values as string[];
        state.index.set(uri, { uri, did, collection, record, cid });
        return [];
      }
      if (text.includes('SELECT') && text.includes('FROM happyview_records') && text.includes('uri =')) {
        const hit = state.index.get(values[0] as string);
        return hit ? [hit] : [];
      }
      if (text.includes('SELECT') && text.includes('FROM happyview_records')) {
        const [did, collection] = values as string[];
        return [...state.index.values()].filter((r) => r.did === did && r.collection === collection);
      }
      if (text.includes('DELETE FROM happyview_records')) {
        state.index.delete(values[0] as string);
        return [];
      }
      return [];
    };
    return sql;
  },
}));

vi.mock('./outbound', () => ({ resolveDidDocument: state.resolveDid, outboundFetch: state.fetch }));

import { createRecord, deleteRecord, getRecord, listRecords, putRecord, MAX_READ_PAGES, RecordError, type RecordInstall } from './records';

const GAME = 'com.example.diplomacy.game';
const MODERATOR = 'app.atmobb.forum.moderator';

const gameLexicon = {
  lexicon: 1,
  id: GAME,
  defs: {
    main: {
      type: 'record',
      key: 'any',
      record: {
        type: 'object',
        required: ['phase'],
        properties: { phase: { type: 'string', maxLength: 32 }, thread: { type: 'string', format: 'at-uri' } },
      },
    },
  },
} as unknown as LexiconDoc;

const moderatorLexicon = {
  lexicon: 1,
  id: MODERATOR,
  defs: { main: { type: 'record', key: 'any', record: { type: 'object', properties: { did: { type: 'string' } } } } },
} as unknown as LexiconDoc;

const install = (collections: string[] = [GAME], lexicons: LexiconDoc[] = [gameLexicon]): RecordInstall => ({
  collections: new Set(collections),
  lexicons,
});

const json = (status: number, body: unknown) => ({ status, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) });

const pdsDoc = (did: string) => ({
  id: did,
  service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.test' }],
});

async function refusal(promise: Promise<unknown>): Promise<RecordError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RecordError);
  return error as RecordError;
}

const networkUntouched = () => {
  expect(state.agentCalls).toEqual([]);
  expect(state.pgCalls).toBe(0);
  expect(state.fetch).not.toHaveBeenCalled();
  expect(state.resolveDid).not.toHaveBeenCalled();
};

beforeEach(() => {
  state.env.ATMOBB_FORUM_DID = FORUM;
  state.env.ATMOBB_FORUM_WRITE_MODE = 'pds';
  state.repo.clear();
  state.index.clear();
  state.agentCalls.length = 0;
  state.pgCalls = 0;
  state.writeError = null;
  state.resolveDid.mockReset();
  state.fetch.mockReset();
});

afterEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key];
});

describe('publishing', () => {
  it('refuses a collection outside the approved set before any network call', async () => {
    const error = await refusal(createRecord(install(), { collection: 'com.example.diplomacy.other', record: { phase: 'S1901M' } }));
    expect(error.code).toBe('CollectionNotApproved');
    await refusal(putRecord(install(), { collection: 'com.example.diplomacy.other', rkey: 'a', record: { phase: 'S1901M' } }));
    await refusal(deleteRecord(install(), { collection: 'com.example.diplomacy.other', rkey: 'a' }));
    networkUntouched();
  });

  it('refuses a reserved collection even when a tampered approved set lists it', async () => {
    const tampered = install([GAME, MODERATOR], [gameLexicon, moderatorLexicon]);
    const error = await refusal(putRecord(tampered, { collection: MODERATOR, rkey: 'self', record: { did: 'did:plc:mallory' } }));
    expect(error.code).toBe('CollectionReserved');
    await refusal(createRecord(tampered, { collection: MODERATOR, record: { did: 'did:plc:mallory' } }));
    await refusal(deleteRecord(tampered, { collection: MODERATOR, rkey: 'self' }));
    networkUntouched();
  });

  it("writes the declared collection's $type over a guest-supplied one", async () => {
    const ref = await putRecord(install(), { collection: GAME, rkey: 'g1', record: { $type: MODERATOR, phase: 'S1901M' } });
    expect(ref).toEqual({ uri: `at://${FORUM}/${GAME}/g1`, cid: expect.any(String) });
    expect(state.repo.get(ref.uri)!.value).toEqual({ $type: GAME, phase: 'S1901M' });
  });

  it('refuses a record that fails the lexicon, naming the path', async () => {
    const error = await refusal(createRecord(install(), { collection: GAME, record: { thread: 'at://did:plc:x/y/z' } }));
    expect(error.code).toBe('InvalidRecord');
    expect(error.message).toBe('Record must have the property "phase"');
    const tooLong = await refusal(putRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'x'.repeat(40) } }));
    expect(tooLong.message).toContain('Record/phase');
    networkUntouched();
  });

  it('refuses a malformed record key before any network call', async () => {
    const error = await refusal(putRecord(install(), { collection: GAME, rkey: '../moderator/self', record: { phase: 'S1901M' } }));
    expect(error.code).toBe('InvalidRecordKey');
    networkUntouched();
  });

  it('overwrites on a second put with the same record key', async () => {
    await putRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'S1901M' } });
    await putRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'F1901M' } });
    expect(state.agentCalls).toEqual(['putRecord', 'putRecord']);
    expect([...state.repo.values()].map((r) => r.value)).toEqual([{ $type: GAME, phase: 'F1901M' }]);
  });

  it('creates at a chosen record key without adding fields the extension did not write', async () => {
    const ref = await createRecord(install(), { collection: GAME, rkey: 'g2', record: { phase: 'S1901M' } });
    expect(ref.uri).toBe(`at://${FORUM}/${GAME}/g2`);
    expect(state.agentCalls).toEqual(['createRecord']);
    expect(state.repo.get(ref.uri)!.value).toEqual({ $type: GAME, phase: 'S1901M' });
  });

  it('writes only to the forum repo and deletes from it', async () => {
    const ref = await createRecord(install(), { collection: GAME, record: { phase: 'S1901M' } });
    expect(ref.uri.startsWith(`at://${FORUM}/${GAME}/`)).toBe(true);
    await deleteRecord(install(), { collection: GAME, rkey: ref.uri.split('/').pop()! });
    expect(state.repo.size).toBe(0);
  });

  it('surfaces the reconnect message when the forum session lacks the scope', async () => {
    state.writeError = Object.assign(new Error(`Missing required scope "repo:${GAME}?action=create"`), { status: 403 });
    const error = await refusal(createRecord(install(), { collection: GAME, record: { phase: 'S1901M' } }));
    expect(error.code).toBe('ForumNeedsReconnect');
    expect(error.message).toBe('The forum account needs updated permissions. Reconnect it in Admin → Connection, then try again.');
  });

  it("reports a PDS write failure's status without its response text", async () => {
    state.writeError = Object.assign(new Error('internal: disk /var/pds/secret full'), { status: 500 });
    const error = await refusal(putRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'S1901M' } }));
    expect(error.code).toBe('WriteFailed');
    expect(error.status).toBe(500);
    expect(error.message).toContain('500');
    expect(error.message).not.toContain('secret');
  });
});

describe('the dev index write mode', () => {
  beforeEach(() => {
    state.env.ATMOBB_FORUM_WRITE_MODE = 'index';
  });

  it('reads back a published record from the forum repo', async () => {
    const ref = await putRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'S1901M' } });
    await putRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'F1901M' } });
    expect(state.agentCalls).toEqual([]);

    const listed = await listRecords(install(), { repo: FORUM, collection: GAME });
    expect(listed.records).toEqual([{ uri: ref.uri, cid: ref.cid, value: { $type: GAME, phase: 'F1901M' } }]);
    expect(await getRecord(install(), { repo: FORUM, collection: GAME, rkey: 'g1' })).toEqual(listed.records[0]);
    expect(await getRecord(install(), { repo: FORUM, collection: GAME, rkey: 'nope' })).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('reads the forum repo from the index when no repo is named', async () => {
    const ref = await putRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'S1901M' } });
    const listed = await listRecords(install(), { collection: GAME });
    expect(listed.records).toEqual([{ uri: ref.uri, cid: ref.cid, value: { $type: GAME, phase: 'S1901M' } }]);
    expect(await getRecord(install(), { collection: GAME, rkey: 'g1' })).toEqual(listed.records[0]);
    expect(state.agentCalls).toEqual([]);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.resolveDid).not.toHaveBeenCalled();
  });

  it('refuses a create at a record key that already exists', async () => {
    await createRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'S1901M' } });
    await refusal(createRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'F1901M' } }));
    expect(JSON.parse(state.index.get(`at://${FORUM}/${GAME}/g1`)!.record)).toEqual({ $type: GAME, phase: 'S1901M' });
  });
});

describe('reading', () => {
  const page = (records: unknown[], cursor?: string) => json(200, { records, cursor });
  const rec = (did: string, collection: string, rkey: string) => ({ uri: `at://${did}/${collection}/${rkey}`, cid: `bafy${rkey}`, value: { $type: collection, phase: rkey } });

  it("reads the forum's own repo through the forum account", async () => {
    await putRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'S1901M' } });
    const listed = await listRecords(install(), { repo: FORUM, collection: GAME });
    expect(listed.records).toHaveLength(1);
    expect(await getRecord(install(), { repo: FORUM, collection: GAME, rkey: 'g1' })).toMatchObject({ value: { phase: 'S1901M' } });
    expect(await getRecord(install(), { repo: FORUM, collection: GAME, rkey: 'missing' })).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("reads the forum's own repo when no repo is named", async () => {
    await putRecord(install(), { collection: GAME, rkey: 'g1', record: { phase: 'S1901M' } });
    state.agentCalls.length = 0;
    expect((await listRecords(install(), { collection: GAME })).records).toEqual([
      { uri: `at://${FORUM}/${GAME}/g1`, cid: expect.any(String), value: { $type: GAME, phase: 'S1901M' } },
    ]);
    expect(await getRecord(install(), { collection: GAME, rkey: 'g1' })).toMatchObject({ uri: `at://${FORUM}/${GAME}/g1` });
    expect(await getRecord(install(), { collection: GAME, rkey: 'missing' })).toBeNull();
    expect(state.agentCalls).toEqual(['listRecords', 'getRecord', 'getRecord']);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.resolveDid).not.toHaveBeenCalled();
  });

  it("resolves another repo's PDS through the hardened fetcher and follows cursors", async () => {
    state.resolveDid.mockResolvedValue(pdsDoc(OTHER));
    state.fetch
      .mockResolvedValueOnce(page([rec(OTHER, GAME, 'a')], 'c1'))
      .mockResolvedValueOnce(page([rec(OTHER, GAME, 'b')]));
    const listed = await listRecords(install(), { repo: OTHER, collection: GAME });
    expect(state.resolveDid).toHaveBeenCalledWith(OTHER);
    expect(listed.records.map((r) => r.uri)).toEqual([rec(OTHER, GAME, 'a').uri, rec(OTHER, GAME, 'b').uri]);
    expect(listed.truncated).toBe(false);
    const urls = state.fetch.mock.calls.map(([url]) => new URL(url as string));
    expect(urls[0].origin + urls[0].pathname).toBe('https://pds.example.test/xrpc/com.atproto.repo.listRecords');
    expect(urls[0].searchParams.get('repo')).toBe(OTHER);
    expect(urls[0].searchParams.get('collection')).toBe(GAME);
    expect(urls[0].searchParams.has('cursor')).toBe(false);
    expect(urls[1].searchParams.get('cursor')).toBe('c1');
    expect(state.agentCalls).toEqual([]);
  });

  it('stops at the page cap', async () => {
    state.resolveDid.mockResolvedValue(pdsDoc(OTHER));
    let n = 0;
    state.fetch.mockImplementation(async () => page([rec(OTHER, GAME, `r${n}`)], `c${++n}`));
    const listed = await listRecords(install(), { repo: OTHER, collection: GAME });
    expect(state.fetch).toHaveBeenCalledTimes(MAX_READ_PAGES);
    expect(listed.records).toHaveLength(MAX_READ_PAGES);
    expect(listed.truncated).toBe(true);
  });

  it('drops records whose uri names a different repo or collection', async () => {
    state.resolveDid.mockResolvedValue(pdsDoc(OTHER));
    state.fetch.mockResolvedValueOnce(
      page([rec(OTHER, GAME, 'real'), rec('did:plc:player', GAME, 'fake'), rec(OTHER, 'com.example.diplomacy.other', 'wrong'), { uri: 'nonsense', cid: 'x', value: {} }]),
    );
    const listed = await listRecords(install(), { repo: OTHER, collection: GAME });
    expect(listed.records.map((r) => r.uri)).toEqual([rec(OTHER, GAME, 'real').uri]);

    state.fetch.mockResolvedValueOnce(json(200, rec('did:plc:player', GAME, 'real')));
    expect(await getRecord(install(), { repo: OTHER, collection: GAME, rkey: 'real' })).toBeNull();
  });

  it("drops a forum-repo record whose uri names another repo", async () => {
    state.repo.set(`at://${FORUM}/${GAME}/spoof`, { uri: `at://did:plc:player/${GAME}/spoof`, cid: 'bafyx', value: { $type: GAME, phase: 'X' } });
    expect((await listRecords(install(), { repo: FORUM, collection: GAME })).records).toEqual([]);
  });

  it('returns null for a record another PDS does not have', async () => {
    state.resolveDid.mockResolvedValue(pdsDoc(OTHER));
    state.fetch.mockResolvedValueOnce(json(400, { error: 'RecordNotFound', message: 'Could not locate record' }));
    expect(await getRecord(install(), { repo: OTHER, collection: GAME, rkey: 'gone' })).toBeNull();
  });

  it("reports a PDS error's status without its response text", async () => {
    state.resolveDid.mockResolvedValue(pdsDoc(OTHER));
    state.fetch.mockResolvedValue(json(502, { error: 'Upstream', message: 'secret internal detail' }));
    const listError = await refusal(listRecords(install(), { repo: OTHER, collection: GAME }));
    expect(listError.code).toBe('ReadFailed');
    expect(listError.status).toBe(502);
    expect(listError.message).toContain('502');
    expect(listError.message).not.toContain('secret');
    const getError = await refusal(getRecord(install(), { repo: OTHER, collection: GAME, rkey: 'a' }));
    expect(getError.status).toBe(502);
    expect(getError.message).not.toContain('secret');
  });

  it('refuses an unapproved collection or an invalid repo before any network call', async () => {
    expect((await refusal(listRecords(install(), { repo: OTHER, collection: 'com.example.diplomacy.other' }))).code).toBe('CollectionNotApproved');
    expect((await refusal(getRecord(install(), { repo: OTHER, collection: MODERATOR, rkey: 'self' }))).code).toBe('CollectionNotApproved');
    expect((await refusal(listRecords(install(), { repo: 'not-a-did', collection: GAME }))).code).toBe('InvalidRepo');
    networkUntouched();
  });

  it('refuses a repo whose DID document lists no PDS', async () => {
    state.resolveDid.mockResolvedValue({ id: OTHER, service: [] });
    expect((await refusal(listRecords(install(), { repo: OTHER, collection: GAME }))).code).toBe('ReadFailed');
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
