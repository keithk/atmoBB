import { describe, expect, it } from 'vitest';
import { RateWindows } from './rate-window';

describe('RateWindows', () => {
  it('takes slots up to the limit, then refuses until the oldest leaves the span', () => {
    const windows = new RateWindows(10);
    expect(windows.take('a', 2, 1_000, 0)).toBe(true);
    expect(windows.take('a', 2, 1_000, 500)).toBe(true);
    expect(windows.left('a', 2, 1_000, 900)).toBe(0);
    expect(windows.take('a', 2, 1_000, 900)).toBe(false);
    expect(windows.left('a', 2, 1_000, 1_000)).toBe(1);
    expect(windows.take('a', 2, 1_000, 1_000)).toBe(true);
  });

  it('drops a key once its window has emptied', () => {
    const windows = new RateWindows(10);
    windows.take('a', 5, 1_000, 0);
    windows.take('b', 5, 1_000, 0);
    expect(windows.size).toBe(2);
    expect(windows.left('a', 5, 1_000, 1_000)).toBe(5);
    expect(windows.size).toBe(1);
    expect(windows.take('b', 5, 1_000, 2_000)).toBe(true);
    expect(windows.size).toBe(1);
  });

  it('evicts the key that least recently took a slot once past the cap, and an evicted key starts fresh', () => {
    const windows = new RateWindows(2);
    expect(windows.take('a', 1, 60_000, 0)).toBe(true);
    expect(windows.take('b', 1, 60_000, 1)).toBe(true);
    // A refusal doesn't count as recent use, so 'a' is still the oldest.
    expect(windows.take('a', 1, 60_000, 2)).toBe(false);
    expect(windows.take('c', 1, 60_000, 3)).toBe(true);
    expect(windows.size).toBe(2);
    expect(windows.left('b', 1, 60_000, 4)).toBe(0);
    expect(windows.take('a', 1, 60_000, 5)).toBe(true);
    expect(windows.left('b', 1, 60_000, 6)).toBe(1);
    expect(windows.left('c', 1, 60_000, 6)).toBe(0);
  });
});
