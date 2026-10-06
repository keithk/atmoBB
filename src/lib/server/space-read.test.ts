import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const records = vi.hoisted(() => new Map<string, { uri: string; cid: string; value: Record<string, unknown> }>());
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('./happyview-session', () => ({ mintSessionCookie: (did: string) => `session:${did}` }));
vi.mock('./profiles', () => ({ getPublicProfile: async () => ({ displayName: 'Test member' }) }));

import { readSpaceBoardThreads, readSpaceThreadPage } from './space-read';

const space = 'at://did:plc:forum/space/thread/board';
let inline = true;
let failure: { error: string; status: number } | undefined;
const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
  if (url.pathname.endsWith('getStamps')) return Response.json({ tray: [], worn: [] });
  if (url.pathname.endsWith('listMembers')) {
    return Response.json({ members: [{ did: 'did:plc:viewer', read: true, write: true }] });
  }
  expect((init?.headers as Record<string, string>).cookie).toContain(encodeURIComponent('session:did:plc:viewer'));
  const params = url.searchParams;
  const author = params.get('repo');
  const collection = params.get('collection');
  if (url.pathname.endsWith('listRepos')) {
    const repos = [...new Set([...records.keys()].map((key) => key.split('/')[0]))].map((did) => ({ did }));
    const start = Number(params.get('cursor') ?? 0);
    return Response.json({ repos: repos.slice(start, start + 100), ...(start + 100 < repos.length ? { cursor: String(start + 100) } : {}) });
  }
  if (url.pathname.endsWith('listRecords')) {
    const refs = [...records.entries()].filter(([key]) => key.startsWith(`${author}/${collection}/`))
      .map(([key, rec]) => ({ rkey: key.split('/')[2], collection, cid: rec.cid, ...(inline && params.get('includeValues') === 'true' ? { value: rec.value } : {}) }));
    const start = Number(params.get('cursor') ?? 0);
    return Response.json({ records: refs.slice(start, start + 100), cursor: start + 100 < refs.length ? String(start + 100) : null });
  }
  if (url.pathname.endsWith('getRecord')) {
    if (failure) return Response.json({ error: failure.error }, { status: failure.status });
    return Response.json(records.get(`${author}/${collection}/${params.get('rkey')}`));
  }
  throw new Error(`Unexpected request: ${url}`);
});

function add(author: string, kind: 'thread' | 'reply', key: string, value: Record<string, unknown>) {
  const collection = `app.atmobb.discussion.${kind}`;
  const uri = `at://did:plc:forum/space/thread/board/${author}/${collection}/${key}`;
  records.set(`${author}/${collection}/${key}`, { uri, cid: key, value });
  return uri;
}

beforeEach(() => {
  records.clear();
  inline = true;
  failure = undefined;
  fetch.mockClear();
  vi.stubGlobal('fetch', fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('permissioned board lists', () => {
  it('keeps full homepage totals while paging only when explicitly requested', async () => {
    for (let i = 0; i < 28; i++) add('did:plc:author', 'thread', `t${i}`, {
      board: 'at://board', title: `Topic ${i}`, createdAt: new Date(i * 1000).toISOString(),
    });
    const home = await readSpaceBoardThreads('did:plc:viewer', space, undefined);
    expect(home.threads).toHaveLength(28);
    expect(home.cursor).toBeUndefined();
    const page = await readSpaceBoardThreads('did:plc:viewer', space, undefined, { limit: 25 });
    expect(page.threads).toHaveLength(25);
    expect(page.cursor).toBe('25');
    const last = await readSpaceBoardThreads('did:plc:viewer', space, undefined, { offset: 25, limit: 25 });
    expect(last.threads.map((thread) => thread.title)).toEqual(['Topic 2', 'Topic 1', 'Topic 0']);
    expect(last.filteredCount).toBe(28);
  });

  it('combines literal title and tag filters without changing unfiltered totals', async () => {
    add('did:plc:author', 'thread', 'match', { board: 'at://board', title: '100%_ complete', tags: ['help'] });
    add('did:plc:author', 'thread', 'wrong-tag', { board: 'at://board', title: '100%_ complete', tags: ['news'] });
    add('did:plc:author', 'thread', 'wrong-title', { board: 'at://board', title: '10000 complete', tags: ['help'] });
    const page = await readSpaceBoardThreads('did:plc:viewer', space, { name: 'Private', threadCount: 0, replyCount: 0 }, { q: '100%_', tag: 'help' });
    expect(page.threads.map((thread) => thread.uri.split('/').at(-1))).toEqual(['match']);
    expect(page.filteredCount).toBe(1);
    expect(page.board?.threadCount).toBe(3);
  });

  it('deduplicates participants and breaks equal-activity ties by DID', async () => {
    const uri = add('did:plc:owner', 'thread', 'topic', { board: 'at://board', title: 'Participants' });
    for (const [author, key, second] of [['did:plc:z', 'one', 1], ['did:plc:b', 'two', 2], ['did:plc:a', 'three', 2], ['did:plc:b', 'four', 0]] as const) {
      add(author, 'reply', key, { thread: { uri }, createdAt: new Date(second * 1000).toISOString() });
    }
    const page = await readSpaceBoardThreads('did:plc:viewer', space, undefined);
    expect(page.threads[0].participants?.map((member) => member.did)).toEqual(['did:plc:owner', 'did:plc:a', 'did:plc:b', 'did:plc:z']);
  });

  it('consumes inline values across more than 100 records and authors without per-record reads', async () => {
    for (let i = 0; i < 105; i++) {
      const uri = add('did:plc:owner', 'thread', `t${i}`, { board: 'at://board', title: `Topic ${i}`, createdAt: new Date(i * 1000).toISOString() });
      add(`did:plc:reply${i}`, 'reply', `r${i}`, { thread: { uri }, createdAt: new Date((i + 1) * 1000).toISOString() });
    }
    const page = await readSpaceBoardThreads('did:plc:viewer', space, { name: 'Private', threadCount: 0, replyCount: 0 });
    expect(page.threads).toHaveLength(105);
    expect(page.threads[0]).toMatchObject({ title: 'Topic 104', replyCount: 1, lastReplyBy: 'did:plc:reply104' });
    expect(page.board).toMatchObject({ threadCount: 105, replyCount: 105 });
    expect(fetch.mock.calls.some(([url]) => url.pathname.endsWith('getRecord'))).toBe(false);
  });

  it('falls back only for absent values and skips a named vanished record', async () => {
    inline = false;
    add('did:plc:owner', 'thread', 'one', { board: 'at://board', title: 'Fallback' });
    expect((await readSpaceBoardThreads('did:plc:viewer', space, undefined)).threads[0].title).toBe('Fallback');
    failure = { error: 'RecordNotFound', status: 400 };
    expect((await readSpaceBoardThreads('did:plc:viewer', space, undefined)).threads).toEqual([]);
    failure = { error: 'Record not found', status: 404 };
    expect((await readSpaceBoardThreads('did:plc:viewer', space, undefined)).threads).toEqual([]);
  });

  it('reads thread replies inline across pages, preserving oldest-first order and parent links', async () => {
    const uri = add('did:plc:owner', 'thread', 'one', { board: 'at://board', title: 'Thread' });
    for (let i = 104; i >= 0; i--) add('did:plc:reply', 'reply', `r${i}`, {
      thread: { uri }, parent: { uri, cid: 'one' }, createdAt: new Date(i * 1000).toISOString(),
    });
    add('did:plc:reply', 'reply', 'other', { thread: { uri: 'at://other' } });
    const page = await readSpaceThreadPage('did:plc:viewer', uri);
    expect(page.thread?.value.title).toBe('Thread');
    expect(page.replyCount).toBe(105);
    expect(page.replies[0]).toMatchObject({ cid: 'r0', value: { parent: { uri, cid: 'one' } } });
    expect(page.replies.at(-1)?.cid).toBe('r104');
    expect(fetch.mock.calls.filter(([url]) => url.pathname.endsWith('getRecord'))).toHaveLength(1);
  });

  it('does not fetch a replacement for an explicitly present invalid inline value', async () => {
    const uri = add('did:plc:owner', 'thread', 'invalid', { board: 'at://board', title: 'Invalid' });
    records.set('did:plc:owner/app.atmobb.discussion.thread/invalid', { uri, cid: 'invalid', value: null as unknown as Record<string, unknown> });
    await expect(readSpaceBoardThreads('did:plc:viewer', space, undefined)).rejects.toThrow();
    expect(fetch.mock.calls.some(([url]) => url.pathname.endsWith('getRecord'))).toBe(false);
  });

  it('returns absence only for a named missing thread head', async () => {
    failure = { error: 'RecordNotFound', status: 400 };
    await expect(readSpaceThreadPage('did:plc:viewer', `${space}/did:plc:owner/app.atmobb.discussion.thread/missing`))
      .resolves.toEqual({ replies: [], replyCount: 0 });
  });

  it('propagates a later record-list failure rather than showing partial totals', async () => {
    for (let i = 0; i < 101; i++) add('did:plc:owner', 'thread', `t${i}`, { board: 'at://board', title: `Topic ${i}` });
    const realFetch = fetch.getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => url.pathname.endsWith('listRecords') && url.searchParams.has('cursor')
      ? Response.json({ error: 'InternalServerError' }, { status: 500 })
      : realFetch(url, init)));
    await expect(readSpaceBoardThreads('did:plc:viewer', space, undefined)).rejects.toMatchObject({ error: 'InternalServerError' });
  });

  it.each([{ error: 'AuthRequired', status: 401 }, { error: 'Forbidden', status: 403 }, { error: 'NotFound', status: 404 }, { error: 'InternalServerError', status: 500 }])('does not hide $error from fallback reads or thread heads', async (error) => {
    inline = false;
    const uri = add('did:plc:owner', 'thread', 'one', { board: 'at://board', title: 'Fallback' });
    failure = error;
    await expect(readSpaceBoardThreads('did:plc:viewer', space, undefined)).rejects.toMatchObject(error);
    await expect(readSpaceThreadPage('did:plc:viewer', uri)).rejects.toMatchObject(error);
  });
});
