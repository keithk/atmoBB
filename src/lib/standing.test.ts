import { describe, expect, it } from 'vitest';
import { banCovering, expiryFromDays } from './standing';

const a = 'at://did:plc:forum/app.atmobb.forum.board/aaa';
const b = 'at://did:plc:forum/app.atmobb.forum.board/bbb';
const now = new Date('2026-09-01T00:00:00Z');

describe('banCovering', () => {
  it('applies a forum-wide ban everywhere and a board ban only there', () => {
    const wide = { uri: 'w', since: '2026-08-01T00:00:00Z' };
    const onA = { uri: 'a', since: '2026-08-01T00:00:00Z', board: a };
    expect(banCovering([wide], b, now)).toBe(wide);
    expect(banCovering([wide], undefined, now)).toBe(wide);
    expect(banCovering([onA], a, now)).toBe(onA);
    expect(banCovering([onA], b, now)).toBeUndefined();
    expect(banCovering([onA], undefined, now)).toBeUndefined();
  });
  it('ignores expired bans', () => {
    const old = { uri: 'o', since: '2026-07-01T00:00:00Z', until: '2026-08-01T00:00:00Z' };
    expect(banCovering([old], a, now)).toBeUndefined();
  });
});

describe('expiryFromDays', () => {
  it('turns days into a timestamp and blank or zero into no expiry', () => {
    expect(expiryFromDays('7', now)).toBe('2026-09-08T00:00:00.000Z');
    expect(expiryFromDays('', now)).toBeUndefined();
    expect(expiryFromDays('0', now)).toBeUndefined();
  });
});
