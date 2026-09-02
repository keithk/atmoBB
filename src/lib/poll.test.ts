import { describe, expect, it } from 'vitest';
import { parsePoll, pollClosed } from './poll';

const base = { question: '', options: '', multiple: false, days: '' };

describe('parsePoll', () => {
  it('is null when no poll was filled in', () => {
    expect(parsePoll(base)).toBeNull();
  });
  it('rejects a question without options, and a single option', () => {
    expect(parsePoll({ ...base, question: 'why?' })).toHaveProperty('error');
    expect(parsePoll({ ...base, options: 'only one' })).toHaveProperty('error');
  });
  it('splits options by line, trims, and drops blanks', () => {
    expect(parsePoll({ ...base, options: ' a \n\nb\r\nc ' })).toEqual({ poll: { options: ['a', 'b', 'c'] } });
  });
  it('sets multiple choice and a closing time from days', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    expect(parsePoll({ question: 'q', options: 'a\nb', multiple: true, days: '3' }, now)).toEqual({
      poll: { question: 'q', options: ['a', 'b'], multipleChoice: true, closesAt: '2026-09-04T00:00:00.000Z' },
    });
  });
  it('caps options and days', () => {
    expect(parsePoll({ ...base, options: Array.from({ length: 11 }, (_, i) => `o${i}`).join('\n') })).toHaveProperty('error');
    expect(parsePoll({ ...base, options: 'a\nb', days: '400' })).toHaveProperty('error');
  });
});

describe('pollClosed', () => {
  it('is closed only once closesAt has passed', () => {
    const now = new Date('2026-09-02T00:00:00Z');
    expect(pollClosed({ options: ['a', 'b'] }, now)).toBe(false);
    expect(pollClosed({ options: ['a', 'b'], closesAt: '2026-09-03T00:00:00Z' }, now)).toBe(false);
    expect(pollClosed({ options: ['a', 'b'], closesAt: '2026-09-01T00:00:00Z' }, now)).toBe(true);
  });
});
