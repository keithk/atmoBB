import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LexiconDoc } from '@atproto/lexicon';
const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
import {
  MAX_DECLARED_COLLECTIONS,
  MAX_LEXICON_BYTES,
  MAX_LEXICON_REF_DEPTH,
  MAX_SCOPE_LENGTH,
  admitExtension,
  checkPublishedLexicons,
  extensionsEnabled,
  lexiconResolver,
  validateManifest,
  type LexiconResolver,
} from './manifest';

const recordMain = (properties: Record<string, unknown> = { thread: { type: 'string', format: 'at-uri' } }) => ({
  type: 'record',
  key: 'tid',
  record: { type: 'object', properties },
});
const lexicon = (id: string, defs: Record<string, unknown> = { main: recordMain() }) => ({ lexicon: 1, id, defs });

/** A manifest declaring `collections`, shipping one record lexicon per collection plus any `extra` docs. */
function bundle(collections: string[], overrides: Record<string, unknown> = {}, extra: object[] = []) {
  const docs = [...collections.map((id) => lexicon(id)), ...extra] as { id: string }[];
  const files = Object.fromEntries(docs.map((doc, i) => [`lexicons/${i}.json`, JSON.stringify(doc)]));
  const manifest = {
    id: 'diplomacy',
    name: 'Diplomacy',
    version: '0.1.0',
    hostApi: '1.0',
    dataVersion: 1,
    collections,
    capabilities: ['kv', 'records'],
    ui: { entry: 'ui/index.html' },
    lexicons: Object.keys(files),
    ...overrides,
  };
  return { manifest, files };
}

const GAME = 'com.example.diplomacy.game';
const ORDER = 'com.example.diplomacy.order';

function admit(collections: string[], overrides: Record<string, unknown> = {}, extra: object[] = []) {
  const { manifest, files } = bundle(collections, overrides, extra);
  return admitExtension(manifest, files);
}

function errorsOf(result: { ok: boolean; errors?: { field: string; message: string }[] }) {
  if (result.ok) throw new Error('expected the manifest to be refused');
  return result.errors!;
}

afterEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key];
});

describe('extensionsEnabled', () => {
  it('is on unless ATMOBB_EXTENSIONS is off', () => {
    expect(extensionsEnabled()).toBe(true);
    state.env.ATMOBB_EXTENSIONS = 'off';
    expect(extensionsEnabled()).toBe(false);
  });
});

describe('validateManifest', () => {
  it('accepts a host API with the same major and an older or equal minor', () => {
    expect(validateManifest(bundle([GAME], { hostApi: '1.1' }).manifest, '1.2')).toMatchObject({ ok: true });
    expect(validateManifest(bundle([GAME], { hostApi: '1.2' }).manifest, '1.2')).toMatchObject({ ok: true });
  });

  it('refuses a newer minor or a different major with a message naming hostApi', () => {
    const newer = errorsOf(validateManifest(bundle([GAME], { hostApi: '1.3' }).manifest, '1.2'));
    expect(newer).toEqual([{ field: 'hostApi', message: expect.stringMatching(/^hostApi: .*1\.3.*1\.2/) }]);
    for (const hostApi of ['2.0', '0.9']) {
      const other = errorsOf(validateManifest(bundle([GAME], { hostApi }).manifest, '1.2'));
      expect(other).toEqual([{ field: 'hostApi', message: expect.stringContaining('hostApi') }]);
    }
    expect(errorsOf(validateManifest(bundle([GAME], { hostApi: '1' }).manifest, '1.2'))[0].field).toBe('hostApi');
  });

  it('names each malformed field', () => {
    const { manifest } = bundle([GAME], {
      name: '',
      dataVersion: 1.5,
      capabilities: ['kv', 'filesystem'],
      ui: { entry: '../../etc/passwd' },
      lexicons: ['/abs/game.json'],
    });
    const fields = errorsOf(validateManifest(manifest)).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'dataVersion', 'capabilities[1]', 'ui.entry', 'lexicons[0]']));
    expect(errorsOf(validateManifest(null))[0]).toMatchObject({ field: 'manifest' });
  });

  it('accepts any manifest id, since installs never use it for paths', () => {
    expect(validateManifest(bundle([GAME], { id: '../../oauth-sessions' }).manifest)).toMatchObject({ ok: true });
  });
});

describe('admitExtension', () => {
  it('admits a valid manifest and lists its approved collections and scope', () => {
    const result = admit([GAME, ORDER], { binding: { collection: GAME, threadField: 'thread' } });
    expect(result).toMatchObject({
      ok: true,
      authority: 'com.example.diplomacy',
      collections: [GAME, ORDER],
      scope: `repo:${GAME} repo:${ORDER}`,
    });
  });

  it('refuses collections atmoBB, atproto, Bluesky, or the forum scopes own, naming the field', () => {
    for (const collection of ['app.atmobb.forum.moderator', 'app.atmobb.moderation.action', 'com.atproto.repo.strongRef', 'app.bsky.feed.post', 'chat.bsky.convo.message', 'tools.ozone.team.member', 'pub.atmo.notify.thing']) {
      const errors = errorsOf(admit([collection]));
      expect(errors).toContainEqual({ field: 'collections[0]', message: expect.stringContaining(collection) });
    }
  });

  it('refuses anything the NSID parser rejects, including scope syntax and wildcards', () => {
    for (const collection of ['foo.bar.baz rpc:*', 'foo.bar.baz?action=create', 'foo.bar.*', 'foo.bar']) {
      const { manifest, files } = bundle([GAME]);
      const errors = errorsOf(admitExtension({ ...manifest, collections: [collection] }, files));
      expect(errors).toContainEqual({ field: 'collections[0]', message: expect.stringContaining('NSID') });
    }
  });

  it('refuses a collection whose domain part is not lowercase', () => {
    const errors = errorsOf(admit(['App.Atmobb.forum.moderator']));
    expect(errors).toContainEqual({ field: 'collections[0]', message: expect.stringContaining('lowercase') });
  });

  it('refuses a collection with no shipped lexicon or whose main definition is not a record', () => {
    const { manifest, files } = bundle([GAME]);
    const missing = errorsOf(admitExtension({ ...manifest, collections: [GAME, ORDER] }, files));
    expect(missing).toContainEqual({ field: 'collections[1]', message: expect.stringContaining('lexicon') });

    const notRecord = errorsOf(admit([], { collections: [GAME] }, [lexicon(GAME, { main: { type: 'object', properties: {} } })]));
    expect(notRecord).toContainEqual({ field: 'collections[0]', message: expect.stringContaining('record') });
  });

  it('refuses collections under more than one authority', () => {
    const errors = errorsOf(admit([GAME, 'org.other.diplomacy.game']));
    expect(errors).toContainEqual({ field: 'collections', message: expect.stringContaining('authority') });
  });

  it('caps the number of collections and the scope length', () => {
    const many = Array.from({ length: MAX_DECLARED_COLLECTIONS + 1 }, (_, i) => `com.example.diplomacy.c${i}`);
    expect(errorsOf(admit(many))).toContainEqual({ field: 'collections', message: expect.stringContaining(String(MAX_DECLARED_COLLECTIONS)) });

    const segment = 'a'.repeat(60);
    const long = Array.from({ length: 6 }, (_, i) => `com.example.${segment}.${segment}.${segment}.n${i}`);
    expect(long.join(' ').length).toBeGreaterThan(MAX_SCOPE_LENGTH);
    expect(long.length).toBeLessThanOrEqual(MAX_DECLARED_COLLECTIONS);
    expect(errorsOf(admit(long))).toContainEqual({ field: 'collections', message: expect.stringContaining('scope') });
  });

  it('refuses a duplicate collection', () => {
    const { manifest, files } = bundle([GAME]);
    expect(errorsOf(admitExtension({ ...manifest, collections: [GAME, GAME] }, files))).toContainEqual({ field: 'collections[1]', message: expect.stringContaining('more than once') });
  });

  it('refuses a lexicon file that is missing, oversized, or not a valid lexicon', () => {
    const { manifest, files } = bundle([GAME]);
    const missing = errorsOf(admitExtension({ ...manifest, lexicons: [...manifest.lexicons, 'lexicons/nope.json'] }, files));
    expect(missing).toContainEqual({ field: 'lexicons[1]', message: expect.stringContaining('lexicons/nope.json') });

    const big = lexicon(GAME, { main: { ...recordMain(), description: 'x'.repeat(MAX_LEXICON_BYTES) } });
    const oversized = errorsOf(admitExtension(manifest, { [manifest.lexicons[0]]: JSON.stringify(big) }));
    expect(oversized).toContainEqual({ field: 'lexicons[0]', message: expect.stringContaining('bytes') });

    const invalid = errorsOf(admitExtension(manifest, { [manifest.lexicons[0]]: JSON.stringify(lexicon(GAME, { main: { type: 'bogus' } })) }));
    expect(invalid).toContainEqual({ field: 'lexicons[0]', message: expect.stringContaining('not a valid lexicon') });
  });

  it('refuses refs that do not resolve, that loop, or that run too deep', () => {
    const dangling = errorsOf(admit([], { collections: [GAME] }, [lexicon(GAME, { main: recordMain({ x: { type: 'ref', ref: 'com.example.diplomacy.defs#missing' } }) })]));
    expect(dangling).toContainEqual({ field: 'collections[0]', message: expect.stringContaining('com.example.diplomacy.defs#missing') });

    const loop = errorsOf(admit([], { collections: [GAME] }, [
      lexicon(GAME, { main: recordMain({ a: { type: 'ref', ref: '#a' } }), a: { type: 'object', properties: { b: { type: 'union', refs: ['#a'] } } } }),
    ]));
    expect(loop).toContainEqual({ field: 'collections[0]', message: expect.stringContaining('refers back') });

    const chain: Record<string, unknown> = { main: recordMain({ next: { type: 'ref', ref: '#d0' } }) };
    for (let i = 0; i <= MAX_LEXICON_REF_DEPTH; i++) {
      chain[`d${i}`] = { type: 'object', properties: { next: { type: 'ref', ref: `#d${i + 1}` } } };
    }
    chain[`d${MAX_LEXICON_REF_DEPTH + 1}`] = { type: 'object', properties: {} };
    expect(errorsOf(admit([], { collections: [GAME] }, [lexicon(GAME, chain)]))).toContainEqual({ field: 'collections[0]', message: expect.stringContaining('deep') });

    const shallow = admit([], { collections: [GAME] }, [
      lexicon(GAME, { main: recordMain({ order: { type: 'ref', ref: `${ORDER}#unit` } }) }),
      lexicon(ORDER, { unit: { type: 'object', properties: {} } }),
    ]);
    expect(shallow).toMatchObject({ ok: true });
  });

  it('checks the binding points at a declared collection with a string thread field', () => {
    expect(admit([GAME], { binding: { collection: ORDER, threadField: 'thread' } }).ok).toBe(false);
    const errors = errorsOf(admit([GAME], { binding: { collection: GAME, threadField: 'nope' } }));
    expect(errors).toContainEqual({ field: 'binding.threadField', message: expect.stringContaining('nope') });
  });

  it('refuses a manifest that fails validation before looking at collections', () => {
    const errors = errorsOf(admit([GAME], { hostApi: '9.0' }));
    expect(errors.map((e) => e.field)).toEqual(['hostApi']);
  });
});

describe('checkPublishedLexicons', () => {
  const game = lexicon(GAME) as LexiconDoc;
  const order = lexicon(ORDER) as LexiconDoc;
  const resolver = (did: string | null, published: Record<string, unknown>): LexiconResolver => ({
    authorityDid: vi.fn(async () => did),
    publishedSchema: vi.fn(async (_did: string, nsid: string) => published[nsid] ?? null),
  });
  // Published records carry $type and may order keys differently.
  const asPublished = (doc: object) => {
    const reordered = Object.fromEntries(Object.entries(doc).reverse());
    return { $type: 'com.atproto.lexicon.schema', ...reordered };
  };

  it('verifies when every shipped lexicon under the authority matches what is published', async () => {
    const r = resolver('did:plc:author', { [GAME]: asPublished(game), [ORDER]: asPublished(order) });
    expect(await checkPublishedLexicons('com.example.diplomacy', [game, order], r)).toEqual({ status: 'verified', did: 'did:plc:author' });
    expect(r.authorityDid).toHaveBeenCalledWith('com.example.diplomacy');
  });

  it('refuses when a published schema differs, naming the NSID', async () => {
    const changed = { ...game, defs: { main: recordMain({ other: { type: 'string' } }) } };
    const result = await checkPublishedLexicons('com.example.diplomacy', [game, order], resolver('did:plc:author', { [GAME]: changed, [ORDER]: order }));
    expect(result).toMatchObject({ status: 'refused', did: 'did:plc:author', differing: [GAME], error: expect.stringContaining(GAME) });
  });

  it('records unpublished, not refused, when there is no TXT record or nothing published', async () => {
    expect(await checkPublishedLexicons('com.example.diplomacy', [game], resolver(null, {}))).toEqual({ status: 'unpublished', missing: [GAME] });
    expect(await checkPublishedLexicons('com.example.diplomacy', [game], resolver('did:plc:author', {}))).toEqual({ status: 'unpublished', did: 'did:plc:author', missing: [GAME] });
    expect(await checkPublishedLexicons('com.example.diplomacy', [game, order], resolver('did:plc:author', { [GAME]: game }))).toEqual({ status: 'unpublished', did: 'did:plc:author', missing: [ORDER] });
  });

  it('treats a resolver failure as unpublished with a warning', async () => {
    const failing: LexiconResolver = {
      authorityDid: async () => 'did:plc:author',
      publishedSchema: async () => { throw new Error('PDS timed out'); },
    };
    expect(await checkPublishedLexicons('com.example.diplomacy', [game], failing)).toEqual({
      status: 'unpublished',
      missing: [GAME],
      warning: expect.stringContaining('PDS timed out'),
    });
  });

  it('ignores shipped lexicons under other authorities', async () => {
    const other = lexicon('org.other.defs', { main: { type: 'object', properties: {} } }) as LexiconDoc;
    const r = resolver('did:plc:author', { [GAME]: game });
    expect(await checkPublishedLexicons('com.example.diplomacy', [game, other], r)).toEqual({ status: 'verified', did: 'did:plc:author' });
    expect(r.publishedSchema).toHaveBeenCalledTimes(1);
  });
});

describe('lexiconResolver', () => {
  const didDoc = { id: 'did:plc:author', service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }] };
  const response = (status: number, body: unknown) => ({ status, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) });

  it('reads the authority DID from the _lexicon TXT record on the reversed domain', async () => {
    const resolveTxt = vi.fn(async () => [['did=did:plc:author']]);
    const r = lexiconResolver({ resolveTxt, resolveDidDocument: vi.fn(), fetch: vi.fn() });
    expect(await r.authorityDid('com.example.diplomacy')).toBe('did:plc:author');
    expect(resolveTxt).toHaveBeenCalledWith('_lexicon.diplomacy.example.com');
  });

  it('returns null when the TXT record is absent and throws when it is ambiguous or malformed', async () => {
    const notFound = Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' });
    const absent = lexiconResolver({ resolveTxt: async () => { throw notFound; }, resolveDidDocument: vi.fn(), fetch: vi.fn() });
    expect(await absent.authorityDid('com.example.diplomacy')).toBeNull();
    const unrelated = lexiconResolver({ resolveTxt: async () => [['v=spf1']], resolveDidDocument: vi.fn(), fetch: vi.fn() });
    expect(await unrelated.authorityDid('com.example.diplomacy')).toBeNull();
    const ambiguous = lexiconResolver({ resolveTxt: async () => [['did=did:plc:a'], ['did=did:plc:b']], resolveDidDocument: vi.fn(), fetch: vi.fn() });
    await expect(ambiguous.authorityDid('com.example.diplomacy')).rejects.toThrow();
    const malformed = lexiconResolver({ resolveTxt: async () => [['did=not a did']], resolveDidDocument: vi.fn(), fetch: vi.fn() });
    await expect(malformed.authorityDid('com.example.diplomacy')).rejects.toThrow();
  });

  it('fetches the schema record from the DID\'s PDS', async () => {
    const fetch = vi.fn(async () => response(200, { uri: 'at://x', value: { $type: 'com.atproto.lexicon.schema', id: GAME } }));
    const r = lexiconResolver({ resolveTxt: vi.fn(), resolveDidDocument: vi.fn(async () => didDoc), fetch });
    expect(await r.publishedSchema('did:plc:author', GAME)).toEqual({ $type: 'com.atproto.lexicon.schema', id: GAME });
    expect(fetch).toHaveBeenCalledWith(
      `https://pds.example.com/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aauthor&collection=com.atproto.lexicon.schema&rkey=${GAME}`,
      expect.objectContaining({ maxBytes: expect.any(Number) }),
    );
  });

  it('returns null for a missing record and throws for other failures', async () => {
    const missing = lexiconResolver({ resolveTxt: vi.fn(), resolveDidDocument: async () => didDoc, fetch: async () => response(400, { error: 'RecordNotFound' }) });
    expect(await missing.publishedSchema('did:plc:author', GAME)).toBeNull();
    const broken = lexiconResolver({ resolveTxt: vi.fn(), resolveDidDocument: async () => didDoc, fetch: async () => response(500, { error: 'InternalServerError' }) });
    await expect(broken.publishedSchema('did:plc:author', GAME)).rejects.toThrow('500');
    const noPds = lexiconResolver({ resolveTxt: vi.fn(), resolveDidDocument: async () => ({ id: 'did:plc:author' }), fetch: vi.fn() });
    await expect(noPds.publishedSchema('did:plc:author', GAME)).rejects.toThrow('PDS');
  });
});
