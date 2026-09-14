import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The trusted mark: atmobb.app staff endorse a repository and the SHAs they
// reviewed, in the directory forum's own repo. endorsementFor is the
// install-review lookup — it must never throw and never block an install,
// whether that's read straight from this forum's own repo (this install is
// the directory) or fetched from the directory DID's PDS through the
// hardened outbound fetcher (this install is someone else's forum). The
// write side (endorseRelease, removeReviewedSha, listEndorsements) backs the
// /admin/extensions/endorse page, which exists only on the directory itself.

const FORUM = 'did:plc:someforum';
const DIRECTORY = 'did:plc:atmobbdirectory';
const ENDORSEMENT = 'app.atmobb.extension.endorsement';
const DIPLOMACY = 'https://github.com/jack/diplomacy';
const CHESS = 'https://github.com/jack/chess';

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  forumDid: 'did:plc:someforum',
  repo: new Map<string, { uri: string; cid: string; value: Record<string, unknown> }[]>(),
  listForumRecords: vi.fn(),
  getForumRecord: vi.fn(),
  putForumRecord: vi.fn(),
  resolveDidDocument: vi.fn(),
  outboundFetch: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('../appview', () => ({ FORUM_DID: () => state.forumDid }));
vi.mock('../forum-repo', () => ({
  listForumRecords: state.listForumRecords,
  getForumRecord: state.getForumRecord,
  putForumRecord: state.putForumRecord,
}));
vi.mock('./outbound', async () => {
  const actual = await vi.importActual<typeof import('./outbound')>('./outbound');
  return { ...actual, resolveDidDocument: state.resolveDidDocument, outboundFetch: state.outboundFetch };
});

import {
  clearEndorsementCacheForTests,
  endorsementFor,
  endorsementRkey,
  endorseRelease,
  listEndorsements,
  removeReviewedSha,
} from './endorsement';

function put(gitUrl: string, value: Record<string, unknown>, rkey = endorsementRkey(gitUrl), did = DIRECTORY) {
  const records = state.repo.get(ENDORSEMENT) ?? [];
  const uri = `at://${did}/${ENDORSEMENT}/${rkey}`;
  const filtered = records.filter((r) => r.uri !== uri);
  filtered.push({ uri, cid: `bafy${rkey}`, value: { $type: ENDORSEMENT, ...value } });
  state.repo.set(ENDORSEMENT, filtered);
  return uri;
}

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key];
  state.forumDid = FORUM;
  state.repo = new Map();
  vi.clearAllMocks();
  clearEndorsementCacheForTests();
  state.listForumRecords.mockImplementation(async (collection: string) => state.repo.get(collection) ?? []);
  state.getForumRecord.mockImplementation(async (collection: string, rkey: string) => {
    const uri = `at://${state.forumDid}/${collection}/${rkey}`;
    return (state.repo.get(collection) ?? []).find((r) => r.uri === uri) ?? null;
  });
  state.putForumRecord.mockImplementation(async (collection: string, rkey: string, value: Record<string, unknown>) => {
    const uri = `at://${state.forumDid}/${collection}/${rkey}`;
    const records = (state.repo.get(collection) ?? []).filter((r) => r.uri !== uri);
    records.push({ uri, cid: `bafy${rkey}`, value: { $type: collection, ...value } });
    state.repo.set(collection, records);
    return { uri, cid: `bafy${rkey}` };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('endorsementRkey', () => {
  it('is the same key for URL variants that normalize the same, and differs otherwise', () => {
    const key = endorsementRkey(DIPLOMACY);
    expect(endorsementRkey('https://github.com/jack/diplomacy.git')).toBe(key);
    expect(endorsementRkey('https://github.com/jack/diplomacy/')).toBe(key);
    expect(endorsementRkey(CHESS)).not.toBe(key);
  });

  it('keeps the key existing endorsement records were written at', () => {
    expect(endorsementRkey(DIPLOMACY)).toBe('ikvo6ae3eix3wbshxhuo7r2brvzu7hpt');
  });
});

describe('endorsementFor', () => {
  it('is unverified with no network call when ATMOBB_EXTENSION_DIRECTORY_DID is unset', async () => {
    const result = await endorsementFor(DIPLOMACY, 'abc123');
    expect(result).toEqual({ status: 'unverified' });
    expect(state.resolveDidDocument).not.toHaveBeenCalled();
    expect(state.outboundFetch).not.toHaveBeenCalled();
    expect(state.getForumRecord).not.toHaveBeenCalled();
  });

  describe('when this install is the directory', () => {
    beforeEach(() => {
      state.env.ATMOBB_EXTENSION_DIRECTORY_DID = DIRECTORY;
      state.forumDid = DIRECTORY;
    });

    it('reads its own repo directly, with no network call', async () => {
      put(DIPLOMACY, { gitUrl: DIPLOMACY, key: DIPLOMACY, reviewed: ['sha1', 'sha2'], createdAt: 't', updatedAt: 't' });
      expect(await endorsementFor(DIPLOMACY, 'sha1')).toEqual({ status: 'endorsed', reviewed: true, listing: undefined });
      expect(await endorsementFor(DIPLOMACY, 'sha3')).toEqual({ status: 'endorsed', reviewed: false, listing: undefined });
      expect(state.resolveDidDocument).not.toHaveBeenCalled();
      expect(state.outboundFetch).not.toHaveBeenCalled();
    });

    it('is unverified when there is no endorsement for the repository', async () => {
      expect(await endorsementFor(CHESS, 'sha1')).toEqual({ status: 'unverified' });
    });

    it('carries the listing thread through when the record names one', async () => {
      put(DIPLOMACY, { gitUrl: DIPLOMACY, key: DIPLOMACY, reviewed: ['sha1'], listing: 'at://did:plc:x/app.atmobb.discussion.thread/3k', createdAt: 't', updatedAt: 't' });
      expect(await endorsementFor(DIPLOMACY, 'sha1')).toMatchObject({ listing: 'at://did:plc:x/app.atmobb.discussion.thread/3k' });
    });
  });

  describe('when another install looks up the directory', () => {
    beforeEach(() => {
      state.env.ATMOBB_EXTENSION_DIRECTORY_DID = DIRECTORY;
      state.resolveDidDocument.mockResolvedValue({
        id: DIRECTORY,
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }],
      });
    });

    function respond(status: number, body: unknown) {
      state.outboundFetch.mockResolvedValue({ status, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) });
    }

    it('fetches the record through the hardened fetcher and reports reviewed status', async () => {
      const rkey = endorsementRkey(DIPLOMACY);
      respond(200, { uri: `at://${DIRECTORY}/${ENDORSEMENT}/${rkey}`, cid: 'bafy', value: { reviewed: ['deadbeef'] } });
      expect(await endorsementFor(DIPLOMACY, 'deadbeef')).toEqual({ status: 'endorsed', reviewed: true, listing: undefined });
      expect(state.outboundFetch).toHaveBeenCalledTimes(1);
      const [url] = state.outboundFetch.mock.calls[0];
      expect(url).toContain('https://pds.example/xrpc/com.atproto.repo.getRecord');
      expect(url).toContain(`repo=${encodeURIComponent(DIRECTORY)}`);
      expect(url).toContain(`rkey=${rkey}`);
    });

    it('caches a lookup briefly, so a second call within the window makes no second request', async () => {
      const rkey = endorsementRkey(DIPLOMACY);
      respond(200, { uri: `at://${DIRECTORY}/${ENDORSEMENT}/${rkey}`, cid: 'bafy', value: { reviewed: ['deadbeef'] } });
      await endorsementFor(DIPLOMACY, 'deadbeef');
      await endorsementFor(DIPLOMACY, 'deadbeef');
      expect(state.outboundFetch).toHaveBeenCalledTimes(1);
    });

    it('is unverified on a missing record (400), a PDS error status, or a thrown timeout — and never blocks the caller', async () => {
      respond(400, { error: 'RecordNotFound' });
      expect(await endorsementFor(DIPLOMACY, 'sha1')).toEqual({ status: 'unverified' });

      clearEndorsementCacheForTests();
      respond(500, { error: 'InternalServerError' });
      expect(await endorsementFor(DIPLOMACY, 'sha1')).toEqual({ status: 'unverified' });

      clearEndorsementCacheForTests();
      state.outboundFetch.mockRejectedValue(new Error('timed out'));
      await expect(endorsementFor(DIPLOMACY, 'sha1')).resolves.toEqual({ status: 'unverified' });
    });

    it('is unverified when resolving the directory DID document fails', async () => {
      state.resolveDidDocument.mockRejectedValue(new Error('unresolvable'));
      expect(await endorsementFor(DIPLOMACY, 'sha1')).toEqual({ status: 'unverified' });
    });

    it('ignores a record whose uri names a different DID than the directory', async () => {
      const rkey = endorsementRkey(DIPLOMACY);
      respond(200, { uri: `at://did:plc:impostor/${ENDORSEMENT}/${rkey}`, cid: 'bafy', value: { reviewed: ['deadbeef'] } });
      expect(await endorsementFor(DIPLOMACY, 'deadbeef')).toEqual({ status: 'unverified' });
    });
  });
});

describe('endorseRelease / listEndorsements / removeReviewedSha', () => {
  beforeEach(() => {
    state.forumDid = DIRECTORY;
  });

  it('creates an endorsement on first review and extends it on a later one, deduping SHAs', async () => {
    const created = await endorseRelease(DIPLOMACY, 'sha1');
    expect(created.reviewed).toEqual(['sha1']);
    expect(created.gitUrl).toBe(DIPLOMACY);
    expect(created.createdAt).toBe(created.updatedAt);

    const extended = await endorseRelease('https://github.com/jack/diplomacy.git', 'sha2');
    expect(extended.reviewed).toEqual(['sha1', 'sha2']);
    expect(extended.createdAt).toBe(created.createdAt);

    const again = await endorseRelease(DIPLOMACY, 'sha1');
    expect(again.reviewed).toEqual(['sha1', 'sha2']);
  });

  it('records an optional listing thread and keeps it across a later review', async () => {
    await endorseRelease(DIPLOMACY, 'sha1', 'at://did:plc:x/app.atmobb.discussion.thread/3k');
    const second = await endorseRelease(DIPLOMACY, 'sha2');
    expect(second.listing).toBe('at://did:plc:x/app.atmobb.discussion.thread/3k');
  });

  it('lists every endorsement in the repo', async () => {
    await endorseRelease(DIPLOMACY, 'sha1');
    await endorseRelease(CHESS, 'sha9');
    const rows = await listEndorsements();
    expect(rows.map((r) => r.gitUrl).sort()).toEqual([CHESS, DIPLOMACY]);
  });

  it('removes one reviewed SHA, leaving the endorsement and any other SHAs in place', async () => {
    await endorseRelease(DIPLOMACY, 'sha1');
    await endorseRelease(DIPLOMACY, 'sha2');
    const updated = await removeReviewedSha(DIPLOMACY, 'sha1');
    expect(updated?.reviewed).toEqual(['sha2']);
    const rows = await listEndorsements();
    expect(rows.find((r) => r.gitUrl === DIPLOMACY)?.reviewed).toEqual(['sha2']);
  });

  it('returns null removing a SHA from a repository with no endorsement', async () => {
    expect(await removeReviewedSha(CHESS, 'sha1')).toBeNull();
  });
});
