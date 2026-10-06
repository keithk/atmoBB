import { describe, expect, it } from 'vitest';
import {
  LOW_CONTRAST,
  TOKEN_LOOK,
  ariaLabel,
  contrastRatio,
  defaultLook,
  isLowContrast,
  lookFor,
  parseLook,
  parseStampForm,
  parseTrigger,
  parseWearing,
  moveStamp,
  stampSymbol,
  stampDescription,
  sameTrigger,
  sponsorDids,
  stampLabel,
  triggerLabel,
  wornEntries,
  wornFromTray,
} from './stamps';
import type { TrayEntry } from './server/appview';

const entry = (id: string, extra: Partial<TrayEntry> = {}): TrayEntry => ({
  id,
  name: id,
  source: 'admin',
  ...extra,
});

describe('parseLook', () => {
  it('accepts full hex colors and a known shape, normalizing case', () => {
    expect(parseLook({ bg: '#A1B2C3', ink: '#000000', shape: 'pill' })).toEqual({
      bg: '#a1b2c3',
      ink: '#000000',
      shape: 'pill',
    });
  });

  it('rejects abbreviated hex, named colors, and unknown shapes', () => {
    expect(parseLook({ bg: '#abc', ink: '#000000', shape: 'pill' })).toBeNull();
    expect(parseLook({ bg: '#a1b2c3', ink: 'red', shape: 'pill' })).toBeNull();
    expect(parseLook({ bg: '#a1b2c3', ink: '#000000', shape: 'hexagon' })).toBeNull();
    expect(parseLook(undefined)).toBeNull();
  });
});

describe('contrast', () => {
  it('flags near-white ink on white as low contrast', () => {
    expect(contrastRatio('#ffffff', '#fafafa')).toBeLessThan(LOW_CONTRAST);
    expect(isLowContrast({ bg: '#ffffff', ink: '#fafafa' })).toBe(true);
  });

  it('passes near-black ink on pale yellow', () => {
    expect(contrastRatio('#ffee88', '#111111')).toBeGreaterThan(LOW_CONTRAST);
    expect(isLowContrast({ bg: '#ffee88', ink: '#111111' })).toBe(false);
  });
});

describe('defaultLook', () => {
  it('inks a dark board color in white and a pale one in near-black', () => {
    expect(defaultLook('#1a73e8')).toMatchObject({ bg: '#1a73e8', ink: '#ffffff' });
    expect(defaultLook('#ffee88')).toMatchObject({ bg: '#ffee88', ink: '#111111' });
  });

  it('falls back to the theme tokens without a color', () => {
    expect(defaultLook()).toBe(TOKEN_LOOK);
    expect(defaultLook('red')).toBe(TOKEN_LOOK);
  });

  it('prefers an entry’s own look over its board color', () => {
    const look = { bg: '#123456', ink: '#ffffff', shape: 'ticket' };
    expect(lookFor(entry('x', { look, boardColor: '#ff0000' }))).toEqual(look);
    expect(lookFor(entry('x', { boardColor: '#ff0000' }))).toMatchObject({ bg: '#ff0000' });
    expect(lookFor(entry('atmobb:arrival'))).toBe(TOKEN_LOOK);
  });
});

describe('wornEntries', () => {
  it('keeps the first six in order', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => entry(id));
    expect(wornEntries(seven).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('resolves worn ids against the tray in the member’s order', () => {
    const tray = ['a', 'b', 'c', 'd'].map((id) => entry(id));
    expect(wornFromTray(tray, ['c', 'a', 'missing', 'd', 'b']).map((e) => e.id)).toEqual(['c', 'a', 'd', 'b']);
  });
});

describe('parseWearing', () => {
  const tray = ['a', 'b', 'c'].map((id) => entry(id, { source: id === 'c' ? 'byHand' : 'admin' }));

  it('keeps only the ids the member checked, so a by-hand stamp left unchecked stays off (AE5)', () => {
    expect(parseWearing(['a', 'b'], tray)).toEqual({ ok: true, ids: ['a', 'b'] });
  });

  it('accepts six and refuses seven rather than truncating', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const tray = ids.map((id) => entry(id));
    expect(parseWearing(ids.slice(0, 6), tray)).toEqual({ ok: true, ids: ids.slice(0, 6) });
    const result = parseWearing(ids, tray);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/6/);
  });

  it('strips ids not in the tray, drops duplicates, and keeps the submitted order', () => {
    expect(parseWearing(['c', 'missing', 'a', 'c', 'a'], tray)).toEqual({ ok: true, ids: ['c', 'a'] });
  });

  it('accepts an empty list: wear nothing', () => {
    expect(parseWearing([], tray)).toEqual({ ok: true, ids: [] });
  });
});

describe('stampLabel', () => {
  const arrival = entry('atmobb:arrival', { name: 'brought in', source: 'default', via: 'invite', sponsor: 'did:plc:x' });

  it('names the sponsor by handle when it resolved', () => {
    expect(stampLabel(arrival, { 'did:plc:x': 'keith.is' })).toBe('brought in by @keith.is');
  });

  it('drops the sponsor when the handle is missing or unresolved', () => {
    expect(stampLabel(arrival, {})).toBe('brought in');
    expect(stampLabel(arrival, { 'did:plc:x': 'did:plc:x' })).toBe('brought in');
  });

  it('reads original member for founding arrivals', () => {
    expect(stampLabel({ ...arrival, via: 'founding', sponsor: undefined }, {})).toBe('original member');
  });

  it('uses the name for every other stamp', () => {
    expect(stampLabel(entry('at://did:plc:f/app.atmobb.forum.stamp/1', { name: 'Regular' }), {})).toBe('Regular');
  });

  it('collects sponsor DIDs from worn arrival stamps', () => {
    expect(sponsorDids([arrival, entry('other', { sponsor: 'did:plc:ignored' })])).toEqual(['did:plc:x']);
  });

  it('tolerates a missing stamp list from an appview that predates stamps', () => {
    expect(sponsorDids(undefined)).toEqual([]);
    expect(sponsorDids([undefined, arrival])).toEqual(['did:plc:x']);
  });

  it('describes board stamps as a first post for assistive tech', () => {
    expect(ariaLabel(entry('atmobb:board:at://b', { name: 'Music', board: 'at://b' }), {})).toBe('Stamp: first post in Music');
    expect(ariaLabel(arrival, { 'did:plc:x': 'keith.is' })).toBe('Stamp: brought in by @keith.is');
  });
});

describe('parseTrigger', () => {
  const BOARD_URI = 'at://did:plc:forum/app.atmobb.forum.board/abc';
  const boards = [BOARD_URI];

  it('accepts a board trigger for a board that exists', () => {
    expect(parseTrigger('firstPostInBoard', { board: BOARD_URI }, boards)).toEqual({
      ok: true,
      trigger: { kind: 'firstPostInBoard', board: BOARD_URI },
    });
  });

  it('rejects a board trigger with a missing or unknown board', () => {
    expect(parseTrigger('firstPostInBoard', {}, boards).ok).toBe(false);
    expect(parseTrigger('firstPostInBoard', { board: 'at://did:plc:forum/app.atmobb.forum.board/gone' }, boards).ok).toBe(false);
  });

  it('rejects a parameter the kind does not take', () => {
    expect(parseTrigger('byHand', { board: BOARD_URI }).ok).toBe(false);
    expect(parseTrigger('firstPostHere', { via: 'invite' }).ok).toBe(false);
    expect(parseTrigger('byHand', {})).toEqual({ ok: true, trigger: { kind: 'byHand' } });
  });

  it('needs a real date for profileBefore, stored as an ISO timestamp', () => {
    expect(parseTrigger('profileBefore', { before: 'yesterday' }).ok).toBe(false);
    expect(parseTrigger('profileBefore', { before: '2026-09-01' })).toEqual({
      ok: true,
      trigger: { kind: 'profileBefore', before: '2026-09-01T00:00:00.000Z' },
    });
  });

  it('limits arrivedBy to the known routes', () => {
    expect(parseTrigger('arrivedBy', { via: 'founding' })).toEqual({
      ok: true,
      trigger: { kind: 'arrivedBy', via: 'founding' },
    });
    expect(parseTrigger('arrivedBy', { via: 'other' }).ok).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(parseTrigger('postCount', {}).ok).toBe(false);
  });
});

describe('parseStampForm', () => {
  const fields = { name: 'Regular', bg: '#1a73e8', ink: '#ffffff', shape: 'pill', kind: 'byHand' };

  it('builds the record value from a valid form', () => {
    expect(parseStampForm(fields)).toEqual({
      ok: true,
      value: { name: 'Regular', look: { bg: '#1a73e8', ink: '#ffffff', shape: 'pill' }, trigger: { kind: 'byHand' } },
    });
  });

  it('warns on low contrast and holds the record until the admin confirms', () => {
    const pale = { ...fields, bg: '#ffffff', ink: '#fafafa' };
    const held = parseStampForm(pale);
    expect(held.ok).toBe(false);
    expect(held.warning).toMatch(/3:1/);
    const confirmed = parseStampForm({ ...pale, confirm: 'on' });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.warning).toMatch(/3:1/);
  });

  it('only reads the trigger parameter the chosen kind uses', () => {
    // A no-JS submit sends every control; the stray board must not fail a byHand stamp.
    const BOARD_URI = 'at://did:plc:forum/app.atmobb.forum.board/abc';
    const result = parseStampForm({ ...fields, board: BOARD_URI, via: 'invite' }, [BOARD_URI]);
    expect(result).toMatchObject({ ok: true, value: { trigger: { kind: 'byHand' } } });
  });

  it('caps names at 24 graphemes, counting emoji as one each', () => {
    expect(parseStampForm({ ...fields, name: 'a'.repeat(25) }).ok).toBe(false);
    const family = '👨‍👩‍👧‍👦';
    expect(parseStampForm({ ...fields, name: family.repeat(24) })).toMatchObject({ ok: true, value: { name: family.repeat(24) } });
    expect(parseStampForm({ ...fields, name: family.repeat(25) }).ok).toBe(false);
    expect(parseStampForm({ ...fields, name: '   ' }).ok).toBe(false);
  });

  it('rejects abbreviated hex and unknown shapes', () => {
    expect(parseStampForm({ ...fields, bg: '#abc' }).ok).toBe(false);
    expect(parseStampForm({ ...fields, shape: 'hexagon' }).ok).toBe(false);
  });

  it('accepts one visible grapheme, including complex emoji, and rejects invisible or multiple symbols', () => {
    for (const symbol of ['A', 'é', '👨‍👩‍👧‍👦', '🇨🇦', '☀️', '1️⃣']) {
      expect(parseStampForm({ ...fields, symbol })).toMatchObject({ ok: true, value: { look: { symbol } } });
    }
    for (const symbol of ['AB', '🙂🙂', '\u200b', '\u202eA', 'A\n', 'a' + '\u0301'.repeat(40)]) {
      expect(parseStampForm({ ...fields, symbol }).ok).toBe(false);
    }
    expect(parseStampForm({ ...fields, symbol: '' })).toMatchObject({ ok: true });
  });
});

describe('compact stamps', () => {
  it('uses the creator’s symbol, with a safe initial for legacy records', () => {
    expect(stampSymbol(entry('x', { name: 'Music', look: { bg: '#ffffff', ink: '#111111', shape: 'stamp', symbol: '🎵' } }))).toBe('🎵');
    expect(stampSymbol(entry('x', { name: 'music' }))).toBe('M');
    expect(stampSymbol(entry('x', { name: '👨‍👩‍👧‍👦 club' }))).toBe('👨‍👩‍👧‍👦');
    expect(stampSymbol(entry('x', { name: 'ßeta' }))).toBe('ß');
    expect(stampSymbol(entry('x', { name: '\u200b' }))).toBe('S');
    expect(stampSymbol(entry('atmobb:arrival', { via: 'founding' }))).toBe('O');
    expect(stampSymbol(entry('atmobb:first-light'))).toBe('☀️');
  });

  it('ignores a malformed symbol without losing a legacy stamp’s colors', () => {
    const look = { bg: '#ffffff', ink: '#111111', shape: 'stamp', symbol: 'too long' };
    expect(parseLook(look)).toEqual({ bg: '#ffffff', ink: '#111111', shape: 'stamp' });
    expect(stampSymbol(entry('x', { name: 'Music', look }))).toBe('M');
  });

  it('explains known earning rules without inventing a reason for legacy or manual awards', () => {
    expect(stampDescription(entry('board', { board: 'at://b', name: 'Music', source: 'default' }))).toBe('Earned by making a first post in Music.');
    expect(stampDescription(entry('x', { trigger: { kind: 'firstPostInBoard', board: 'at://b' }, triggerBoardName: 'Music' }))).toBe('Earned by making a first post in Music.');
    expect(stampDescription(entry('x', { source: 'byHand', trigger: { kind: 'firstPostHere' } }))).toBe('Awarded by this forum’s admins.');
    expect(stampDescription(entry('x'))).toBe('Awarded by this forum. The earning details aren’t available.');
    expect(stampDescription(entry('atmobb:early-days', { source: 'network', trigger: { kind: 'profileBefore', before: '2026-10-01T00:00:00Z' } }))).toContain('2026-10-01');
    expect(stampDescription(entry('atmobb:arrival', { via: 'application', sponsor: 'did:plc:a' }), { 'did:plc:a': 'alice.test' })).toBe('Joined by application, approved by @alice.test.');
  });
});

describe('moveStamp', () => {
  it('moves a stamp without mutating the draft or losing the rest of the selection', () => {
    const ids = ['a', 'at://b', 'c'];
    expect(moveStamp(ids, 'up:at://b')).toEqual(['at://b', 'a', 'c']);
    expect(moveStamp(ids, 'down:at://b')).toEqual(['a', 'c', 'at://b']);
    expect(ids).toEqual(['a', 'at://b', 'c']);
    for (const move of ['up:a', 'down:c', 'sideways:a', 'up:missing']) expect(moveStamp(ids, move)).toEqual(ids);
  });
});

describe('sameTrigger', () => {
  it('treats key order as irrelevant', () => {
    const a = { kind: 'firstPostInBoard', board: 'at://b' };
    const b = { board: 'at://b', kind: 'firstPostInBoard' };
    expect(sameTrigger(a, b)).toBe(true);
  });

  it('treats a different board as a different trigger', () => {
    const a = { kind: 'firstPostInBoard', board: 'at://b' };
    const b = { kind: 'firstPostInBoard', board: 'at://other' };
    expect(sameTrigger(a, b)).toBe(false);
  });
});

describe('triggerLabel', () => {
  it('says what earns the stamp in words', () => {
    expect(triggerLabel({ kind: 'firstPostInBoard', board: 'at://b' }, 'Music')).toBe('first post in Music');
    expect(triggerLabel({ kind: 'firstPostInBoard', board: 'at://b' })).toBe('first post in a board that no longer exists');
    expect(triggerLabel({ kind: 'firstPostHere' })).toBe('first post on this forum');
    expect(triggerLabel({ kind: 'profileBefore', before: '2026-09-01T00:00:00.000Z' })).toBe('profile created before 2026-09-01');
    expect(triggerLabel({ kind: 'arrivedBy', via: 'founding' })).toBe('founding member');
    expect(triggerLabel({ kind: 'byHand' })).toBe('awarded by hand');
  });
});
