import { describe, expect, it } from 'vitest';
import { composeNotification, ownPlainText } from './compose';
import type { RichTextBlock } from '$lib/richtext/bbcode';

const NS = 'app.atmobb.richtext';
const alice = 'did:plc:alice';
const thread = `at://${alice}/app.atmobb.discussion.thread/t1`;

const base = {
  authorHandle: 'bob.test',
  authorDid: 'did:plc:bob',
  threadTitle: 'Hello world',
  boardName: 'General',
  threadUri: thread,
  ownText: 'x'.repeat(600),
  permalink: `https://forum.test/t/${alice}/t1#post-t1`,
  membersOnly: false,
};

describe('composeNotification on a public board', () => {
  it('names the author and thread, excerpts the post, and marks the link before the fragment', () => {
    const out = composeNotification({ ...base, kind: 'thread-reply' });
    expect(out.title).toBe('bob.test replied in "Hello world"');
    expect(out.body).toBe('x'.repeat(500));
    expect(out.category).toBe('thread-reply');
    expect(out.categoryDescription).toBeTruthy();
    expect(out.uri).toBe(`https://forum.test/t/${alice}/t1?via=notify#post-t1`);
    expect(out.threadKey).toBe(thread);
    expect(out.actors).toEqual([{ did: 'did:plc:bob', handle: 'bob.test' }]);
  });

  it('appends the marker to a link that already has a query and no fragment', () => {
    const out = composeNotification({ ...base, kind: 'mention', permalink: 'https://forum.test/t/x/y?cursor=25' });
    expect(out.uri).toBe('https://forum.test/t/x/y?cursor=25&via=notify');
  });

  it('has a distinct title per kind', () => {
    expect(composeNotification({ ...base, kind: 'post-reply' }).title).toBe('bob.test replied to your post in "Hello world"');
    expect(composeNotification({ ...base, kind: 'mention' }).title).toBe('bob.test mentioned you in "Hello world"');
    expect(composeNotification({ ...base, kind: 'board-watch' }).title).toBe('bob.test started "Hello world" in General');
    const categories = (['thread-reply', 'post-reply', 'mention', 'board-watch'] as const).map(
      (kind) => composeNotification({ ...base, kind }).category,
    );
    expect(new Set(categories).size).toBe(4);
  });

  it('cuts a long title to 100 characters with an ellipsis', () => {
    const out = composeNotification({ ...base, kind: 'thread-reply', threadTitle: 't'.repeat(200) });
    expect(out.title).toHaveLength(100);
    expect(out.title.endsWith('…')).toBe(true);
  });
});

describe('composeNotification on a members-only board', () => {
  const membersOnly = {
    ...base,
    membersOnly: true,
    ownText: 'secret words',
    openUrl: 'https://forum.test/notifications/open/abc123?via=notify',
  };

  it('sends fixed strings, no actor, no thread key, and links through the open route', () => {
    const out = composeNotification({ ...membersOnly, kind: 'thread-reply' });
    expect(out.title).toContain('a members-only board');
    expect(out.title).not.toContain('Hello world');
    expect(out.body).not.toContain('secret words');
    expect(out.uri).toBe('https://forum.test/notifications/open/abc123?via=notify');
    expect(out.actors).toBeUndefined();
    expect(out.threadKey).toBeUndefined();
    expect(out.category).toBe('thread-reply');
    expect(JSON.stringify(out)).not.toContain('did:');
    expect(JSON.stringify(out)).not.toContain('bob.test');
    expect(JSON.stringify(out)).not.toContain('General');
  });

  it('names the kind in each fixed title', () => {
    const titles = (['thread-reply', 'post-reply', 'mention', 'board-watch'] as const).map(
      (kind) => composeNotification({ ...membersOnly, kind }).title,
    );
    expect(new Set(titles).size).toBe(4);
    for (const t of titles) expect(t).toContain('a members-only board');
  });
});

describe('ownPlainText', () => {
  const blocks: RichTextBlock[] = [
    { $type: `${NS}.block#quote`, text: 'quoted secret', subject: { uri: thread, cid: 'bafy' } },
    { $type: `${NS}.block#text`, text: 'my own words' },
    { $type: `${NS}.block#code`, text: 'let x = 1;' },
    { $type: `${NS}.block#image`, alt: 'a picture' },
  ];

  it('keeps text and code and drops quotes and images', () => {
    expect(ownPlainText(blocks)).toBe('my own words\n\nlet x = 1;');
  });

  it('gives an empty body for a quote-only post', () => {
    const out = composeNotification({ ...base, kind: 'post-reply', ownText: ownPlainText([blocks[0]]) });
    expect(out.body).toBe('');
    expect(JSON.stringify(out)).not.toContain('quoted secret');
  });
});
