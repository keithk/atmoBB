import { describe, expect, it } from 'vitest';
import { relTime } from './reltime';

const now = Date.parse('2026-11-16T12:00:00Z');

describe('relTime', () => {
  it('counts recent activity in minutes, hours, and days', () => {
    expect(relTime('2026-11-16T11:59:30Z', now)).toBe('just now');
    expect(relTime('2026-11-16T11:49:00Z', now)).toBe('11m ago');
    expect(relTime('2026-11-16T07:00:00Z', now)).toBe('5h ago');
    expect(relTime('2026-11-12T12:00:00Z', now)).toBe('4d ago');
  });

  it('drops the year for older dates this year and the day for earlier years', () => {
    const thisYear = new Date('2026-10-10T12:00:00Z');
    const lastYear = new Date('2025-10-10T12:00:00Z');
    expect(relTime(thisYear.toISOString(), now)).toBe(thisYear.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    expect(relTime(lastYear.toISOString(), now)).toBe(lastYear.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }));
    expect(relTime(lastYear.toISOString(), now)).not.toMatch(/\b10\b/);
  });

  it('returns nothing for missing or unreadable dates', () => {
    expect(relTime(null, now)).toBe('');
    expect(relTime('not a date', now)).toBe('');
  });
});
