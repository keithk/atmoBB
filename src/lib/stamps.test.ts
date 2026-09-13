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
  sponsorDids,
  stampLabel,
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
  it('keeps the first three in order', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => entry(id));
    expect(wornEntries(five).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('resolves worn ids against the tray in the member’s order', () => {
    const tray = ['a', 'b', 'c', 'd'].map((id) => entry(id));
    expect(wornFromTray(tray, ['c', 'a', 'missing', 'd', 'b']).map((e) => e.id)).toEqual(['c', 'a', 'd']);
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

  it('describes board stamps as a first post for assistive tech', () => {
    expect(ariaLabel(entry('atmobb:board:at://b', { name: 'Music', board: 'at://b' }), {})).toBe('Stamp: first post in Music');
    expect(ariaLabel(arrival, { 'did:plc:x': 'keith.is' })).toBe('Stamp: brought in by @keith.is');
  });
});
