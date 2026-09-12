import { describe, expect, it } from 'vitest';
import {
  MAX_READING_NAMESPACES,
  MAX_READING_TOPICS,
  markPostVisible,
  readingStorageKey,
  readReadingState,
  topicReadState,
  type ReadingScope,
} from './reading-state';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const alice = { accountDid: 'did:plc:alice', forumDid: 'did:web:forum.test' };
const topic = 'at://did:plc:author/app.atmobb.discussion.thread/topic';
const activity = (replyCount: number, lastActivity = '2026-01-01T00:00:10Z') => ({
  threadUri: topic,
  canonicalHref: '/t/did:plc:author/topic',
  createdAt: '2026-01-01T00:00:00Z',
  lastActivity,
  replyCount,
});

describe('reading state', () => {
  it('marks only the highest post actually reached, not the whole loaded page', () => {
    const storage = new MemoryStorage();
    markPostVisible(storage, alice, {
      threadUri: topic,
      position: 3,
      postHref: '/t/did:plc:author/topic#post-three',
      postAt: '2026-01-01T00:00:03Z',
    }, '2026-01-02T00:00:00Z');

    expect(topicReadState(readReadingState(storage, alice), activity(9))).toEqual({
      status: 'unread',
      resumeHref: '/t/did:plc:author/topic#post-three',
    });
  });

  it('keeps progress monotonic when paging backward', () => {
    const storage = new MemoryStorage();
    markPostVisible(storage, alice, { threadUri: topic, position: 28, postHref: '/t/x?cursor=25#post-28' });
    markPostVisible(storage, alice, { threadUri: topic, position: 2, postHref: '/t/x#post-2' });
    expect(readReadingState(storage, alice)?.topics[topic]).toMatchObject({
      position: 28,
      postHref: '/t/x?cursor=25#post-28',
    });
    expect(topicReadState(readReadingState(storage, alice), activity(28, ''))?.status).toBe('read');
  });

  it('separates accounts and forums, including private thread URIs', () => {
    const storage = new MemoryStorage();
    const privateTopic = 'at://did:web:forum.test/space/thread/board/did:plc:alice/app.atmobb.discussion.thread/private';
    markPostVisible(storage, alice, { threadUri: privateTopic, position: 1, postHref: '/b/board/t/did:plc:alice/private#post-one' });
    const bob = { ...alice, accountDid: 'did:plc:bob' };
    const elsewhere = { ...alice, forumDid: 'did:web:elsewhere.test' };
    expect(readReadingState(storage, bob)).toBeNull();
    expect(readReadingState(storage, elsewhere)).toBeNull();
    expect(storage.getItem(readingStorageKey(alice))).toContain(privateTopic);
  });

  it('distinguishes unknown old topics, new topics, read topics, and later replies', () => {
    const storage = new MemoryStorage();
    const state = markPostVisible(storage, alice, {
      threadUri: topic,
      position: 2,
      postHref: '/t/x#post-two',
      postAt: '2026-01-02T00:00:00Z',
    }, '2026-01-02T00:00:00Z')!;
    expect(topicReadState(state, activity(2, '2026-01-02T00:00:00Z'))?.status).toBe('read');
    expect(topicReadState(state, activity(3, '2026-01-03T00:00:00Z'))?.status).toBe('unread');
    expect(topicReadState(state, activity(2, '2026-01-03T00:00:00Z'))?.status).toBe('unread');
    expect(topicReadState(state, { ...activity(0), threadUri: 'at://old', createdAt: '2025-01-01T00:00:00Z' })).toBeNull();
    expect(topicReadState(state, { ...activity(0), threadUri: 'at://boundary', createdAt: state.startedAt })).toBeNull();
    expect(topicReadState(state, { ...activity(0), threadUri: 'at://new', createdAt: '2026-01-03T00:00:00Z' })?.status).toBe('new');
  });

  it('recovers from malformed, unavailable, and old-version storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(readingStorageKey(alice), '{bad');
    expect(readReadingState(storage, alice)).toBeNull();
    storage.setItem(readingStorageKey(alice), JSON.stringify({ version: 99, startedAt: '2020-01-01T00:00:00Z', topics: {} }));
    expect(readReadingState(storage, alice)).toBeNull();
    const unavailable = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
    expect(markPostVisible(unavailable, alice, { threadUri: topic, position: 0, postHref: '/t/x' })).toBeNull();
  });

  it('bounds topics and account/forum namespaces by recent use', () => {
    const storage = new MemoryStorage();
    for (let i = 0; i <= MAX_READING_TOPICS; i++) {
      markPostVisible(storage, alice, { threadUri: `at://topic-${i}`, position: 0, postHref: `/t/${i}` }, new Date(i * 1000).toISOString());
    }
    expect(Object.keys(readReadingState(storage, alice)!.topics)).toHaveLength(MAX_READING_TOPICS);
    expect(readReadingState(storage, alice)!.topics['at://topic-0']).toBeUndefined();

    for (let i = 0; i <= MAX_READING_NAMESPACES; i++) {
      const scope: ReadingScope = { accountDid: `did:plc:user-${i}`, forumDid: alice.forumDid };
      markPostVisible(storage, scope, { threadUri: topic, position: 0, postHref: '/t/x' }, new Date(300_000 + i * 1000).toISOString());
    }
    expect(storage.getItem(readingStorageKey({ accountDid: 'did:plc:user-0', forumDid: alice.forumDid }))).toBeNull();
  });
});
