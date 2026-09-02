import { describe, expect, it } from 'vitest';
import { postAnchor, replyPath, threadPath } from './appview-paths';

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
  it('links space replies as a fragment on the unpaginated thread', () => {
    expect(replyPath(spaceThread, spaceReply)).toBe(`${threadPath(spaceThread)}#post-3kbbb`);
  });
});
