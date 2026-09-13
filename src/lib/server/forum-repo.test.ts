import { describe, expect, it } from 'vitest';
import { forumWriteErrorMessage } from './forum-repo';

describe('forumWriteErrorMessage', () => {
  it('directs an admin with a stale scope to reconnect the forum account', () => {
    expect(
      forumWriteErrorMessage(
        new Error('Missing required scope "repo:app.atmobb.moderation.action?action=create"'),
        'write failed',
      ),
    ).toBe(
      'The forum account needs updated permissions. Reconnect it in Admin → Connection, then try again.',
    );
  });

  it('preserves an unrelated PDS error and falls back for a non-error', () => {
    expect(forumWriteErrorMessage(new Error('PDS unavailable'), 'write failed')).toBe('PDS unavailable');
    expect(forumWriteErrorMessage(null, 'write failed')).toBe('write failed');
  });
});
