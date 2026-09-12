import { describe, expect, it } from 'vitest';
import { parseThreadTags } from './thread-tags';
import { threadFilterHref, threadFilters } from './thread-filters';

describe('thread tags', () => {
  it('normalizes, removes blanks and deduplicates consistently', () => {
    expect(parseThreadTags(' Svelte , web   dev\nＳＶＥＬＴＥ')).toEqual({ tags: ['svelte', 'web dev'] });
  });

  it('rejects the ninth distinct tag', () => {
    expect(parseThreadTags('a,b,c,d,e,f,g,h,i').error).toMatch('at most 8');
  });

  it('counts graphemes rather than UTF-16 code units', () => {
    expect(parseThreadTags('😀'.repeat(64))).toEqual({ tags: ['😀'.repeat(64)] });
    expect(parseThreadTags('é'.repeat(65)).error).toMatch('64 characters');
  });
});

describe('thread filters', () => {
  it('normalizes GET filters and ignores a non-AT board value', () => {
    expect(threadFilters(new URLSearchParams('q=%20literal%25_%20&board=https://bad&tag=%20News%20'))).toEqual({
      q: 'literal%_',
      board: undefined,
      tag: 'news',
    });
  });

  it('drops an invalid overlong GET tag instead of sending an invalid XRPC request', () => {
    expect(threadFilters(new URLSearchParams(`tag=${'x'.repeat(65)}`)).tag).toBeUndefined();
  });

  it('preserves combined filters on cursor links and omits cursor when filters change', () => {
    const filters = { q: 'wild%_', board: 'at://did:plc:x/app.atmobb.forum.board/dev', tag: 'help' };
    expect(threadFilterHref(filters, '25')).toBe(
      '?q=wild%25_&board=at%3A%2F%2Fdid%3Aplc%3Ax%2Fapp.atmobb.forum.board%2Fdev&tag=help&cursor=25',
    );
    expect(threadFilterHref(filters)).not.toContain('cursor');
  });
});
