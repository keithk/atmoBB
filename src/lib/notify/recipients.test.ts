import { describe, expect, it } from 'vitest';
import { resolveRecipients } from './recipients';
import type { RichTextBlock } from '$lib/richtext/bbcode';

const NS = 'app.atmobb.richtext';
const forum = 'did:plc:forum';
const alice = 'did:plc:alice';
const bob = 'did:plc:bob';
const carol = 'did:plc:carol';

const thread = `at://${alice}/app.atmobb.discussion.thread/t1`;
const reply = (did: string, rkey: string) => `at://${did}/app.atmobb.discussion.reply/${rkey}`;

const text = (t: string, mentions: string[] = []): RichTextBlock => ({
  $type: `${NS}.block#text`,
  text: t,
  ...(mentions.length
    ? { facets: mentions.map((did) => ({ index: { byteStart: 0, byteEnd: 1 }, features: [{ $type: `${NS}.facet#mention`, did }] })) }
    : {}),
});
const quote = (uri: string, mentions: string[] = []): RichTextBlock => ({
  $type: `${NS}.block#quote`,
  text: 'quoted words',
  subject: { uri, cid: 'bafy' },
  ...(mentions.length
    ? { facets: mentions.map((did) => ({ index: { byteStart: 0, byteEnd: 1 }, features: [{ $type: `${NS}.facet#mention`, did }] })) }
    : {}),
});

const replyRecord = (body: RichTextBlock[], parent?: string) => ({
  thread: { uri: thread, cid: 'bafy' },
  ...(parent ? { parent: { uri: parent, cid: 'bafy' } } : {}),
  body,
});

describe('resolveRecipients for replies', () => {
  it('notifies the thread starter of a reply with no parent, and never the author of their own reply', () => {
    expect(resolveRecipients({ record: replyRecord([text('hi')]), threadUri: thread, authorDid: bob, forumDid: forum })).toEqual([
      { did: alice, kind: 'thread-reply' },
    ]);
    expect(resolveRecipients({ record: replyRecord([text('hi')]), threadUri: thread, authorDid: alice, forumDid: forum })).toEqual([]);
  });

  it('notifies the parent author as post-reply and the starter as thread-reply', () => {
    const parent = reply(carol, 'r1');
    const out = resolveRecipients({
      record: replyRecord([text('hi')], parent),
      threadUri: thread,
      authorDid: bob,
      forumDid: forum,
      threadPostUris: new Set([thread, parent]),
    });
    expect(out).toEqual([
      { did: carol, kind: 'post-reply' },
      { did: alice, kind: 'thread-reply' },
    ]);
  });

  it('counts a post that is both quoted and the parent once', () => {
    const parent = reply(carol, 'r1');
    const out = resolveRecipients({
      record: replyRecord([quote(parent), text('agreed')], parent),
      threadUri: thread,
      authorDid: bob,
      forumDid: forum,
      threadPostUris: new Set([thread, parent]),
    });
    expect(out.filter((r) => r.did === carol)).toEqual([{ did: carol, kind: 'post-reply' }]);
  });

  it('reports a mentioned starter once, as a mention', () => {
    const out = resolveRecipients({ record: replyRecord([text('@alice', [alice])]), threadUri: thread, authorDid: bob, forumDid: forum });
    expect(out).toEqual([{ did: alice, kind: 'mention' }]);
  });

  it('finds mentions inside quote blocks too', () => {
    const out = resolveRecipients({ record: replyRecord([quote(thread, [carol])]), threadUri: thread, authorDid: bob, forumDid: forum });
    expect(out.find((r) => r.did === carol)).toEqual({ did: carol, kind: 'mention' });
  });

  it('excludes the author and the forum even when mentioned', () => {
    const out = resolveRecipients({
      record: replyRecord([text('@me @forum', [bob, forum])]),
      threadUri: thread,
      authorDid: bob,
      forumDid: forum,
    });
    expect(out.map((r) => r.did)).not.toContain(bob);
    expect(out.map((r) => r.did)).not.toContain(forum);
  });

  it('ignores a parent or quote subject that is not a post in this thread', () => {
    const elsewhere = reply(carol, 'other');
    const out = resolveRecipients({
      record: replyRecord([quote(elsewhere)], elsewhere),
      threadUri: thread,
      authorDid: bob,
      forumDid: forum,
      threadPostUris: new Set([thread]),
    });
    expect(out).toEqual([{ did: alice, kind: 'thread-reply' }]);
    // Without the thread's post list nothing can be proven to be in the thread.
    expect(resolveRecipients({ record: replyRecord([text('x')], elsewhere), threadUri: thread, authorDid: bob, forumDid: forum })).toEqual([
      { did: alice, kind: 'thread-reply' },
    ]);
  });

  it('resolves space-shaped URIs to their real authors, not the forum', () => {
    const space = `at://${forum}/space/app.atmobb.forum.privateBoard/b1`;
    const spaceThread = `${space}/${alice}/app.atmobb.discussion.thread/t1`;
    const spaceParent = `${space}/${carol}/app.atmobb.discussion.reply/r1`;
    const spaceQuoted = `${space}/${bob}/app.atmobb.discussion.reply/r2`;
    const out = resolveRecipients({
      record: { thread: { uri: spaceThread, cid: 'bafy' }, parent: { uri: spaceParent, cid: 'bafy' }, body: [quote(spaceQuoted)] },
      threadUri: spaceThread,
      authorDid: 'did:plc:dave',
      forumDid: forum,
      threadPostUris: new Set([spaceThread, spaceParent, spaceQuoted]),
    });
    expect(out).toEqual([
      { did: carol, kind: 'post-reply' },
      { did: bob, kind: 'post-reply' },
      { did: alice, kind: 'thread-reply' },
    ]);
  });

  it('can skip the starter when the caller could not confirm the thread', () => {
    const out = resolveRecipients({
      record: replyRecord([text('@carol', [carol])]),
      threadUri: thread,
      authorDid: bob,
      forumDid: forum,
      skipThreadStarter: true,
    });
    expect(out).toEqual([{ did: carol, kind: 'mention' }]);
  });
});

describe('resolveRecipients for new threads', () => {
  it('notifies watchers other than the author', () => {
    const out = resolveRecipients({
      record: { body: [text('new thread')] },
      threadUri: thread,
      authorDid: alice,
      forumDid: forum,
      watchers: [alice, bob],
    });
    expect(out).toEqual([{ did: bob, kind: 'board-watch' }]);
  });

  it('reports a mentioned watcher once, as a mention', () => {
    const out = resolveRecipients({
      record: { body: [text('@bob', [bob])] },
      threadUri: thread,
      authorDid: alice,
      forumDid: forum,
      watchers: [bob, carol],
    });
    expect(out).toEqual([
      { did: bob, kind: 'mention' },
      { did: carol, kind: 'board-watch' },
    ]);
  });
});
