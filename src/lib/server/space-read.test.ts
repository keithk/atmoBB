import { beforeEach, describe, expect, it, vi } from 'vitest';

const records = vi.hoisted(() => new Map<string, { uri: string; cid: string; value: Record<string, unknown> }>());
vi.mock('./appview', () => ({
  THREAD_NSID: 'app.atmobb.discussion.thread',
  REPLY_NSID: 'app.atmobb.discussion.reply',
  listSpaceRepos: async () => [...new Set([...records.keys()].map((key) => key.split('/')[0]))],
  listSpaceRecords: async (_viewer: string, _space: string, author: string, collection: string) =>
    [...records.keys()].filter((key) => key.startsWith(`${author}/${collection}/`)).map((key) => ({ rkey: key.split('/')[2] })),
  getSpaceRecord: async (_viewer: string, _space: string, author: string, collection: string, rkey: string) =>
    records.get(`${author}/${collection}/${rkey}`),
}));
vi.mock('./profiles', () => ({ getPublicProfile: async () => ({ displayName: 'Test member' }) }));

import { readSpaceBoardThreads } from './space-read';

function add(author: string, kind: 'thread' | 'reply', key: string, value: Record<string, unknown>) {
  const collection = `app.atmobb.discussion.${kind}`;
  const uri = `at://did:plc:forum/space/thread/board/${author}/${collection}/${key}`;
  records.set(`${author}/${collection}/${key}`, { uri, cid: key, value });
  return uri;
}

beforeEach(() => records.clear());

describe('permissioned board lists', () => {
  it('keeps full homepage totals while paging only when explicitly requested', async () => {
    for (let i = 0; i < 28; i++) add('did:plc:author', 'thread', `t${i}`, {
      board: 'at://board', title: `Topic ${i}`, createdAt: new Date(i * 1000).toISOString(),
    });
    const home = await readSpaceBoardThreads('did:plc:viewer', 'at://space', undefined);
    expect(home.threads).toHaveLength(28);
    expect(home.cursor).toBeUndefined();
    const page = await readSpaceBoardThreads('did:plc:viewer', 'at://space', undefined, { limit: 25 });
    expect(page.threads).toHaveLength(25);
    expect(page.cursor).toBe('25');
    const last = await readSpaceBoardThreads('did:plc:viewer', 'at://space', undefined, { offset: 25, limit: 25 });
    expect(last.threads.map((thread) => thread.title)).toEqual(['Topic 2', 'Topic 1', 'Topic 0']);
    expect(last.filteredCount).toBe(28);
  });

  it('combines literal title and tag filters without changing unfiltered totals', async () => {
    add('did:plc:author', 'thread', 'match', { board: 'at://board', title: '100%_ complete', tags: ['help'] });
    add('did:plc:author', 'thread', 'wrong-tag', { board: 'at://board', title: '100%_ complete', tags: ['news'] });
    add('did:plc:author', 'thread', 'wrong-title', { board: 'at://board', title: '10000 complete', tags: ['help'] });
    const page = await readSpaceBoardThreads('did:plc:viewer', 'at://space', { name: 'Private', threadCount: 0, replyCount: 0 }, { q: '100%_', tag: 'help' });
    expect(page.threads.map((thread) => thread.uri.split('/').at(-1))).toEqual(['match']);
    expect(page.filteredCount).toBe(1);
    expect(page.board?.threadCount).toBe(3);
  });

  it('deduplicates participants and breaks equal-activity ties by DID', async () => {
    const uri = add('did:plc:owner', 'thread', 'topic', { board: 'at://board', title: 'Participants' });
    for (const [author, key, second] of [['did:plc:z', 'one', 1], ['did:plc:b', 'two', 2], ['did:plc:a', 'three', 2], ['did:plc:b', 'four', 0]] as const) {
      add(author, 'reply', key, { thread: { uri }, createdAt: new Date(second * 1000).toISOString() });
    }
    const page = await readSpaceBoardThreads('did:plc:viewer', 'at://space', undefined);
    expect(page.threads[0].participants?.map((member) => member.did)).toEqual(['did:plc:owner', 'did:plc:a', 'did:plc:b', 'did:plc:z']);
  });
});
