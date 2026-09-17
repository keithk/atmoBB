import { describe, expect, it } from 'vitest';
import { pathSlug, postAnchor, replyPath, threadPath } from './appview-paths';

const thread = 'at://did:plc:alice/app.atmobb.discussion.thread/3kaaa';
const reply = 'at://did:plc:bob/app.atmobb.discussion.reply/3kbbb';
const spaceThread = 'at://did:plc:forum/space/app.atmobb.forum.privateBoard/3kboard/did:plc:alice/app.atmobb.discussion.thread/3kaaa';
const spaceReply = 'at://did:plc:forum/space/app.atmobb.forum.privateBoard/3kboard/did:plc:bob/app.atmobb.discussion.reply/3kbbb';

describe('postAnchor', () => {
  it('uses the record key for public and space records alike', () => {
    expect(postAnchor(reply)).toBe('post-3kbbb');
    expect(postAnchor(spaceReply)).toBe('post-3kbbb');
  });
});

describe('replyPath', () => {
  it('resolves public replies through the permalink route', () => {
    expect(replyPath(thread, reply)).toBe('/t/did:plc:alice/3kaaa/p/did:plc:bob/3kbbb');
  });
  it('keeps replies under a readable thread path when one is available', () => {
    const href = threadPath(thread, 'General chat', 'What’s everyone building?');
    expect(replyPath(thread, reply, href)).toBe(
      '/t/general-chat/what-s-everyone-building/did:plc:alice/3kaaa/p/did:plc:bob/3kbbb',
    );
  });
  it('links space replies as a fragment on the unpaginated thread', () => {
    expect(replyPath(spaceThread, spaceReply)).toBe(`${threadPath(spaceThread)}#post-3kbbb`);
  });
});

describe('threadPath', () => {
  it('adds readable board and title slugs without replacing the stable identity', () => {
    expect(threadPath(thread, 'Café & Help', 'A title: 100% useful')).toBe(
      '/t/cafe-help/a-title-100-useful/did:plc:alice/3kaaa',
    );
  });
  it('falls back for names containing no letters or numbers', () => {
    expect(pathSlug('✨', 'thread')).toBe('thread');
  });
  it('URL-encodes non-Latin slugs so canonical comparisons are stable', () => {
    expect(threadPath(thread, '交流', 'Добро пожаловать')).toBe(
      '/t/%E4%BA%A4%E6%B5%81/%D0%B4%D0%BE%D0%B1%D1%80%D0%BE-%D0%BF%D0%BE%D0%B6%D0%B0%D0%BB%D0%BE%D0%B2%D0%B0%D1%82%D1%8C/did:plc:alice/3kaaa',
    );
  });
});
