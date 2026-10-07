import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addSpaceMember, createSpace, getBoardAccess, getSpaceRecord, isSpaceMember, listSpaceMembers, listSpaceRecords, listSpaceRepos, spaceKeyFor, SPACE_TYPE } from './appview';

const board = vi.hoisted(() => ({ value: { name: 'Board' } as Record<string, unknown> | null }));
vi.mock('$env/dynamic/private', () => ({ env: { ATMOBB_FORUM_DID: 'did:plc:forum' } }));
vi.mock('./happyview-session', () => ({ mintSessionCookie: (did: string) => `session:${did}` }));
vi.mock('./forum-repo', () => ({
  getForumRecord: async () => board.value === null ? null : {
    uri: 'at://did:plc:forum/app.atmobb.forum.board/board', cid: 'cid', value: board.value,
  },
}));
beforeEach(() => { board.value = { name: 'Board' }; });
afterEach(() => vi.unstubAllGlobals());

it('resolves the returned instance authority from every page of the creator inventory', async () => {
  const space = `at://did:web:host/space/${SPACE_TYPE}/${spaceKeyFor('board')}`;
  const fetch = vi.fn(async (url: URL) => Response.json(url.searchParams.has('cursor')
    ? { spaces: [{ uri: space, isOwner: true }] }
    : { spaces: [], cursor: 'next' }));
  vi.stubGlobal('fetch', fetch);
  expect(await getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).toBe(space);
  const [url] = fetch.mock.calls[0] as unknown as [URL];
  expect(url.pathname).toBe('/xrpc/com.atproto.space.listSpaces');
  expect(url.searchParams.get('spaceType')).toBe(SPACE_TYPE);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps legacy spaces discoverable without using creator DID as the authority rule', async () => {
  const space = `at://did:plc:forum/space/${SPACE_TYPE}/board`;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ spaces: [{ uri: space, isOwner: true }] })));
  expect(await getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).toBe(space);
});

it('only reports public after a complete inventory and ignores a similarly keyed space owned by another forum', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    spaces: [{ uri: `at://did:web:host/space/${SPACE_TYPE}/board`, isOwner: false }],
  })));
  expect(await getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).toBeNull();
  expect(spaceKeyFor('board', 'did:plc:forum')).not.toBe(spaceKeyFor('board', 'did:plc:other'));
});

it.each([401, 403, 404, 500])('never treats an inventory HTTP %s as a public board', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'NotFound' }, { status })));
  await expect(getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).rejects.toMatchObject({ status });
});

it('rejects ambiguous ownership and malformed inventories rather than guessing public access', async () => {
  const fetch = vi.fn(async () => Response.json({ spaces: [
    { uri: `at://did:web:one/space/${SPACE_TYPE}/board`, isOwner: true },
    { uri: `at://did:web:two/space/${SPACE_TYPE}/board`, isOwner: true },
  ] }));
  vi.stubGlobal('fetch', fetch);
  await expect(getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).rejects.toThrow('Multiple');
  fetch.mockResolvedValueOnce(Response.json({ spaces: [{ uri: 'not-a-space', isOwner: true }] }));
  await expect(getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).rejects.toThrow('Invalid');
  await expect(getBoardAccess('not-a-board')).rejects.toThrow('Invalid board');
});

it('never interprets a missing board or a declared private space missing from inventory as public', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ spaces: [] })));
  board.value = null;
  await expect(getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).rejects.toThrow('Board not found');
  board.value = { access: { $type: 'app.atmobb.forum.board#space', space: `at://did:web:host/space/${SPACE_TYPE}/custom` } };
  await expect(getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).rejects.toThrow('unavailable');
});

it('honors the authoritative board reference when its owned space uses a custom key', async () => {
  const uri = `at://did:web:host/space/${SPACE_TYPE}/custom`;
  board.value = { access: { $type: 'app.atmobb.forum.board#space', space: uri } };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ spaces: [{ uri, isOwner: true }] })));
  expect(await getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).toBe(uri);
});

it('accepts the explicit public access variant only when the inventory has no backing space', async () => {
  board.value = { access: { $type: 'app.atmobb.forum.board#public' } };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ spaces: [] })));
  expect(await getBoardAccess('at://did:plc:forum/app.atmobb.forum.board/board')).toBeNull();
});

it('creates a member-list space using the current protocol and returned authority URI', async () => {
  const uri = `at://did:web:host/space/${SPACE_TYPE}/${spaceKeyFor('board')}`;
  const fetch = vi.fn(async () => Response.json({ uri }));
  vi.stubGlobal('fetch', fetch);
  expect(await createSpace('board', { displayName: 'Private' })).toBe(uri);
  const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.pathname).toBe('/xrpc/com.atproto.simplespace.createSpace');
  expect(JSON.parse(init.body as string)).toEqual({
    spaceType: SPACE_TYPE, skey: spaceKeyFor('board'), displayName: 'Private',
    readPolicy: { $type: 'com.atproto.simplespace.defs#memberListPolicy' },
    writePolicy: { $type: 'com.atproto.simplespace.defs#memberListPolicy' },
  });
});

it('puts explicit read/write flags and refuses legacy read_self without sending a request', async () => {
  const fetch = vi.fn(async () => Response.json({}));
  vi.stubGlobal('fetch', fetch);
  for (const access of ['write', 'read'] as const) {
    await addSpaceMember('space', 'did:plc:member', access);
    const [url, init] = fetch.mock.calls.at(-1)! as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/xrpc/com.atproto.simplespace.putMember');
    expect(JSON.parse(init.body as string)).toEqual({ space: 'space', did: 'did:plc:member', read: true, write: access === 'write', isDelegation: false });
  }
  await expect(addSpaceMember('space', 'did:plc:member', 'read_self')).rejects.toThrow('read_self');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('paginates flattened members and requires actual read permission', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => Response.json(url.searchParams.has('cursor')
    ? { members: [{ did: 'reader', read: true, write: false }] }
    : { members: [{ did: 'writer', read: false, write: true }, { did: 'neither', read: false, write: false }], cursor: 'next' })));
  expect(await listSpaceMembers('space')).toEqual([
    { did: 'writer', read: false, write: true, access: 'write', isDelegation: false },
    { did: 'neither', read: false, write: false, access: null, isDelegation: false },
    { did: 'reader', read: true, write: false, access: 'read', isDelegation: false },
  ]);
  expect(await isSpaceMember('space', 'reader')).toBe(true);
  expect(await isSpaceMember('space', 'writer')).toBe(false);
  expect(await isSpaceMember('space', 'neither')).toBe(false);
});

it.each([true, false])('blocks every read before contacting a permissive engine for read=false/write=%s', async (write) => {
  const fetch = vi.fn(async (url: URL) => url.pathname.endsWith('listMembers')
    ? Response.json({ members: [{ did: 'viewer', read: false, write }] })
    : Response.json({ repos: [{ did: 'author' }], records: [{ value: 'private' }], value: 'private' }));
  vi.stubGlobal('fetch', fetch);
  for (const read of [
    () => listSpaceRepos('viewer', 'space'),
    () => listSpaceRecords('viewer', 'space', 'author', 'collection'),
    () => getSpaceRecord('viewer', 'space', 'author', 'collection', 'key'),
  ]) {
    await expect(read()).rejects.toMatchObject({ status: 403 });
  }
  expect(fetch.mock.calls.every(([url]) => url.pathname.endsWith('listMembers'))).toBe(true);
});

it('reads every repo and record page, including inline values and the empty terminal repo page', async () => {
  const fetch = vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('listMembers')) return Response.json({ members: [{ did: 'viewer', read: true, write: true }] });
    expect(url.searchParams.get('limit')).toBe('100');
    const start = Number(url.searchParams.get('cursor') ?? 0);
    const all = Array.from({ length: 101 }, (_, i) => url.pathname.endsWith('listRepos')
      ? { did: `did:plc:${i}` }
      : { collection: 'collection', rkey: String(i), cid: String(i), value: { title: `Topic ${i}` } });
    const items = all.slice(start, start + 100);
    if (url.pathname.endsWith('listRepos')) return Response.json({ repos: items, ...(items.length ? { cursor: String(start + items.length) } : {}) });
    expect(url.searchParams.get('includeValues')).toBe('true');
    expect(url.searchParams.get('repo')).toBe('author');
    return Response.json({ records: items, cursor: start === 0 ? '100' : null });
  });
  vi.stubGlobal('fetch', fetch);
  expect(await listSpaceRepos('viewer', 'space')).toHaveLength(101);
  expect(await listSpaceRecords('viewer', 'space', 'author', 'collection', 100, true)).toHaveLength(101);
  expect(fetch.mock.calls.filter(([url]) => !url.pathname.endsWith('listMembers'))).toHaveLength(5);
});

it.each(['members', 'repos', 'records'])('rejects repeated cursors for %s instead of returning partial data', async (kind) => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => Response.json(
    kind !== 'members' && url.pathname.endsWith('listMembers')
      ? { members: [{ did: 'viewer', read: true, write: true }] }
      : { [kind]: [], cursor: 'loop' },
  )));
  const result = kind === 'members' ? isSpaceMember('space', 'missing')
    : kind === 'repos' ? listSpaceRepos('viewer', 'space')
    : listSpaceRecords('viewer', 'space', 'author', 'collection');
  await expect(result).rejects.toThrow('cursor');
});

it('propagates named errors on a later membership page rather than reporting absence', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => url.searchParams.has('cursor')
    ? Response.json({ error: 'AuthRequired', message: 'Login expired' }, { status: 401 })
    : Response.json({ members: [], cursor: 'next' })));
  await expect(isSpaceMember('space', 'missing')).rejects.toMatchObject({ status: 401, error: 'AuthRequired', message: 'Login expired' });
});

it.each(['members', 'repos', 'records'])('rejects a malformed %s page instead of an empty list', async (kind) => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => Response.json(
    kind !== 'members' && url.pathname.endsWith('listMembers')
      ? { members: [{ did: 'viewer', read: true, write: true }] }
      : {},
  )));
  const result = kind === 'members' ? listSpaceMembers('space')
    : kind === 'repos' ? listSpaceRepos('viewer', 'space')
    : listSpaceRecords('viewer', 'space', 'author', 'collection');
  await expect(result).rejects.toThrow(`missing ${kind}`);
});
