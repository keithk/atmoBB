import type { TrayEntry } from './server/appview';
import { normalizeBoardColor } from './board-presentation';
import { resolvedHandle } from './membership';

export const STAMP_SHAPES = ['stamp', 'pill', 'ticket', 'pixel'] as const;
export type StampShape = (typeof STAMP_SHAPES)[number];

/** Fixed colors an admin (or the network) chose for a stamp. */
export interface StampLook {
  bg: string;
  ink: string;
  shape: StampShape;
}

/** No fixed colors: the theme's `--forum-rank` tokens draw the stamp, so owner CSS keeps working. */
export interface TokenLook {
  shape: StampShape;
  tokens: true;
}

export type ResolvedLook = StampLook | TokenLook;

export const TOKEN_LOOK: TokenLook = { shape: 'pixel', tokens: true };

/** WCAG contrast below this reads as a warning in the admin form. */
export const LOW_CONTRAST = 3;

/** Members wear at most this many stamps at once. */
export const WORN_LIMIT = 3;

export const ARRIVAL_ID = 'atmobb:arrival';

export type Handles = Record<string, string | null | undefined>;

const LIGHT_INK = '#ffffff';
// Near-black rather than pure black: it's the ink stamps print in, and it keeps
// mid-tone board colors (Google-blue territory) on white ink where they read best.
const DARK_INK = '#111111';

const isShape = (value: unknown): value is StampShape => STAMP_SHAPES.includes(value as StampShape);

/** A look from record or form data: full hex bg and ink plus a known shape, or null. */
export function parseLook(input: unknown): StampLook | null {
  if (!input || typeof input !== 'object') return null;
  const { bg, ink, shape } = input as Record<string, unknown>;
  const safeBg = normalizeBoardColor(bg);
  const safeInk = normalizeBoardColor(ink);
  if (!safeBg || !safeInk || !isShape(shape)) return null;
  return { bg: safeBg, ink: safeInk, shape };
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2 contrast ratio between two full hex colors, 1 (same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function isLowContrast(look: Pick<StampLook, 'bg' | 'ink'>): boolean {
  return contrastRatio(look.bg, look.ink) < LOW_CONTRAST;
}

/** The look for a generated stamp: the board's color under whichever ink reads better, or the theme tokens. */
export function defaultLook(boardColor?: string): ResolvedLook {
  const bg = normalizeBoardColor(boardColor);
  if (!bg) return TOKEN_LOOK;
  const ink = contrastRatio(bg, LIGHT_INK) >= contrastRatio(bg, DARK_INK) ? LIGHT_INK : DARK_INK;
  return { bg, ink, shape: 'stamp' };
}

/** An entry's own look when it carries a valid one, else the default for its board color. */
export function lookFor(entry: Pick<TrayEntry, 'look' | 'boardColor'>): ResolvedLook {
  return parseLook(entry.look) ?? defaultLook(entry.boardColor);
}

/** The text on a stamp. Arrival stamps name the route and, when it resolved, the sponsor. */
export function stampLabel(entry: Pick<TrayEntry, 'id' | 'name' | 'via' | 'sponsor'>, handles: Handles = {}): string {
  if (entry.id !== ARRIVAL_ID) return entry.name;
  if (entry.via === 'founding' || !entry.sponsor) return 'original member';
  const handle = resolvedHandle(handles, entry.sponsor);
  return handle ? `brought in by @${handle}` : 'brought in';
}

export function ariaLabel(entry: Pick<TrayEntry, 'id' | 'name' | 'via' | 'sponsor' | 'board'>, handles: Handles = {}): string {
  const label = stampLabel(entry, handles);
  return entry.board ? `Stamp: first post in ${label}` : `Stamp: ${label}`;
}

/** The stamps actually shown: the member's order, capped. */
export function wornEntries<T extends Pick<TrayEntry, 'id'>>(worn: T[]): T[] {
  return worn.slice(0, WORN_LIMIT);
}

/** Resolve the worn ids the appview reports against the tray, in the member's order. */
export function wornFromTray(tray: TrayEntry[], worn: string[]): TrayEntry[] {
  const byId = new Map(tray.map((entry) => [entry.id, entry]));
  return wornEntries(worn.flatMap((id) => byId.get(id) ?? []));
}

/** Sponsor DIDs named by worn arrival stamps, so loaders can resolve their handles. */
export function sponsorDids(worn: Pick<TrayEntry, 'id' | 'sponsor'>[]): string[] {
  return [...new Set(worn.flatMap((entry) => (entry.id === ARRIVAL_ID && entry.sponsor ? [entry.sponsor] : [])))];
}
