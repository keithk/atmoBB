import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOMEPAGE,
  homepageRecord,
  isThreadUri,
  normalizeHomepage,
  rankHotThreads,
  selectFeaturedThreads,
} from './homepage';

const thread = (rkey: string) => `at://did:plc:alice/app.atmobb.discussion.thread/${rkey}`;

describe('normalizeHomepage', () => {
  it('keeps classic defaults for old records', () => {
    expect(normalizeHomepage(undefined)).toEqual(DEFAULT_HOMEPAGE);
    expect(normalizeHomepage({})).toEqual(DEFAULT_HOMEPAGE);
  });

  it('round trips valid settings and preserves featured order', () => {
    const settings = {
      layout: 'categories-latest',
      sidebar: true,
      welcome: 'compact',
      featuredThreads: [thread('third'), thread('first')],
    };
    expect(normalizeHomepage(settings)).toEqual(settings);
  });

  it('defaults invalid scalars and drops invalid or excess featured values', () => {
    expect(normalizeHomepage({
      layout: 'popular',
      sidebar: 'yes',
      welcome: 'large',
      featuredThreads: [
        thread('one'),
        'https://example.com/thread',
        'at://did:plc:alice/app.atmobb.discussion.reply/two',
        thread('three'),
        thread('four'),
        thread('five'),
      ],
    })).toEqual({
      layout: 'boards',
      sidebar: false,
      welcome: 'classic',
      featuredThreads: [thread('one'), thread('three'), thread('four')],
    });
  });
});

describe('isThreadUri', () => {
  it('accepts only full at-uris for thread records', () => {
    expect(isThreadUri(thread('one'))).toBe(true);
    expect(isThreadUri('at://did:plc:alice/app.atmobb.discussion.reply/one')).toBe(false);
    expect(isThreadUri('not-an-at-uri')).toBe(false);
  });
});

describe('homepageRecord', () => {
  it('omits the all-default object but stores configured values losslessly', () => {
    expect(homepageRecord(DEFAULT_HOMEPAGE)).toBeUndefined();
    const configured = normalizeHomepage({ layout: 'latest', featuredThreads: [thread('one')] });
    expect(normalizeHomepage(homepageRecord(configured))).toEqual(configured);
  });
});

describe('homepage feed selection', () => {
  const topics = [
    { uri: thread('low'), replyCount: 2, lastActivity: '2026-09-12T12:00:00Z' },
    { uri: thread('tie-old'), replyCount: 8, lastActivity: '2026-09-11T12:00:00Z' },
    { uri: thread('tie-new'), replyCount: 8, lastActivity: '2026-09-12T12:00:00Z' },
    { uri: thread('quiet'), replyCount: 0, lastActivity: '2026-09-12T13:00:00Z' },
  ];

  it('restores configured featured order and skips unavailable topics', () => {
    expect(selectFeaturedThreads(topics, [thread('tie-old'), thread('missing'), thread('low')]))
      .toEqual([topics[1], topics[0]]);
  });

  it('ranks replied-to topics by replies then recent activity', () => {
    expect(rankHotThreads(topics).map((topic) => topic.uri))
      .toEqual([thread('tie-new'), thread('tie-old'), thread('low')]);
  });
});
