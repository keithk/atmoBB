import { describe, expect, it } from 'vitest';
import { MODERATION_SCOPE, OAUTH_SCOPE, SYSOP_SCOPE, clientMetadata } from './atproto-oauth';

describe('forum OAuth scopes', () => {
  it('requests moderation writes explicitly in both the sysop flow and client metadata', () => {
    expect(SYSOP_SCOPE.split(' ')).toContain(MODERATION_SCOPE);
    expect(OAUTH_SCOPE.split(' ')).toContain(MODERATION_SCOPE);
    expect(clientMetadata().scope.split(' ')).toContain(MODERATION_SCOPE);
  });
});
