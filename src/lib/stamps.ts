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
  /** One fixed letter or emoji, chosen by the stamp's creator. */
  symbol?: string;
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
export const WORN_LIMIT = 6;

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
  const { bg, ink, shape, symbol } = input as Record<string, unknown>;
  const safeBg = normalizeBoardColor(bg);
  const safeInk = normalizeBoardColor(ink);
  if (!safeBg || !safeInk || !isShape(shape)) return null;
  const safeSymbol = parseStampSymbol(symbol);
  return { bg: safeBg, ink: safeInk, shape, ...(safeSymbol ? { symbol: safeSymbol } : {}) };
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
  if (entry.via === 'founding') return 'original member';
  const handle = entry.sponsor ? resolvedHandle(handles, entry.sponsor) : null;
  return handle ? `brought in by @${handle}` : 'brought in';
}

/** Read old or malformed records safely, without discarding their colors. */
export function parseStampSymbol(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input || new TextEncoder().encode(input).length > 64) return;
  // Preserve emoji joiners/variation selectors, but reject controls, bidi tricks,
  // whitespace and invisible-only graphemes.
  if (/[\p{White_Space}\p{Cc}\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(input)) return;
  if (!/[\p{L}\p{N}\p{P}\p{S}]/u.test(input) || graphemes(input) !== 1) return;
  return input;
}

export function stampSymbol(entry: TrayEntry): string {
  const symbol = parseStampSymbol(entry.look?.symbol);
  if (symbol) return symbol;
  if (entry.id === ARRIVAL_ID) return entry.via === 'founding' ? 'O' : entry.via === 'application' ? 'A' : 'I';
  if (entry.id === 'atmobb:first-light') return '☀️';
  if (entry.id === 'atmobb:early-days') return 'E';
  const first = segmenter.segment(entry.name.trim())[Symbol.iterator]().next().value?.segment ?? '';
  return parseStampSymbol(first.toUpperCase()) ?? parseStampSymbol(first) ?? 'S';
}

/** The same factual explanation in the collection and on public stamp details. */
export function stampDescription(entry: TrayEntry, handles: Handles = {}): string {
  if (entry.source === 'byHand') return 'Awarded by this forum’s admins.';
  if (entry.id === ARRIVAL_ID) {
    const sponsor = entry.sponsor ? resolvedHandle(handles, entry.sponsor) : null;
    if (entry.via === 'founding') return 'Here when this forum began.';
    if (entry.via === 'application') return sponsor ? `Joined by application, approved by @${sponsor}.` : 'Joined this forum by application.';
    if (entry.via === 'invite') return sponsor ? `Invited to this forum by @${sponsor}.` : 'Joined this forum by invitation.';
    return 'A keepsake of joining this forum.';
  }
  if (entry.board) return `Earned by making a first post in ${entry.name}.`;
  if (entry.id === 'atmobb:first-light') return 'Earned by making a first post on a forum indexed by this appview.';
  const trigger = entry.trigger;
  switch (trigger?.kind) {
    case 'firstPostInBoard':
      return `Earned by making a first post in ${entry.triggerBoardName ?? 'a board on this forum'}.`;
    case 'firstPostHere':
      return 'Earned by making a first post on this forum.';
    case 'profileBefore':
      return trigger.before && Number.isFinite(Date.parse(trigger.before))
        ? `Earned by creating an atmoBB profile before ${trigger.before.slice(0, 10)}.`
        : 'Earned for an early atmoBB profile.';
    case 'arrivedBy':
      if (trigger.via === 'founding') return 'Earned as a founding member of this forum.';
      if (trigger.via === 'invite') return 'Earned by joining this forum by invitation.';
      if (trigger.via === 'application') return 'Earned by joining this forum by application.';
      break;
    case 'byHand':
      return 'Awarded by this forum’s admins.';
  }
  if (entry.id === 'atmobb:early-days') return 'Earned for an early atmoBB profile.';
  return entry.source === 'network'
    ? 'A stamp shared by the forums on this appview.'
    : 'Awarded by this forum. The earning details aren’t available.';
}

export function stampOrigin(entry: TrayEntry): string {
  return entry.source === 'network' ? 'Across this appview’s forums' : 'From this forum';
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

export type WearingResult = { ok: true; ids: string[] } | { ok: false; error: string };

/**
 * The ids a member chose to wear, from a submitted list: only stamps in their
 * tray, each once, in the order sent. More than the cap is an error rather
 * than a silent trim, so the member sees which to drop.
 */
export function parseWearing(input: string[], tray: Pick<TrayEntry, 'id'>[]): WearingResult {
  const held = new Set(tray.map((entry) => entry.id));
  const ids = [...new Set(input.filter((id) => held.has(id)))];
  if (ids.length > WORN_LIMIT) {
    return { ok: false, error: `You can wear up to ${WORN_LIMIT} stamps. Take off ${ids.length - WORN_LIMIT} to save.` };
  }
  return { ok: true, ids };
}

/** Swap a selected stamp with its neighbor; shared by the draft and no-JS actions. */
export function moveStamp(ids: string[], move: string): string[] {
  const [dir, id] = move.split(/:(.*)/, 2);
  if (dir !== 'up' && dir !== 'down') return ids;
  const at = ids.indexOf(id);
  const to = at + (dir === 'up' ? -1 : 1);
  if (at < 0 || to < 0 || to >= ids.length) return ids;
  const out = [...ids];
  [out[at], out[to]] = [out[to], out[at]];
  return out;
}

/**
 * Sponsor DIDs named by worn arrival stamps, so loaders can resolve their
 * handles. Tolerates a missing list: an appview that predates stamps answers
 * without the field.
 */
export function sponsorDids(worn: (Pick<TrayEntry, 'id' | 'sponsor'> | undefined)[] | undefined): string[] {
  return [
    ...new Set((worn ?? []).flatMap((entry) => (entry?.id === ARRIVAL_ID && entry.sponsor ? [entry.sponsor] : []))),
  ];
}

// --- admin form validation --------------------------------------------------

/** The lexicon's cap on a stamp name, in graphemes. */
export const STAMP_NAME_MAX_GRAPHEMES = 24;

export const TRIGGER_KINDS = ['firstPostInBoard', 'firstPostHere', 'profileBefore', 'arrivedBy', 'byHand'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const ARRIVAL_ROUTES = ['invite', 'application', 'founding'] as const;
export type ArrivalRoute = (typeof ARRIVAL_ROUTES)[number];

/** What earns a stamp: one kind, carrying exactly the parameter that kind needs. */
export type StampTrigger =
  | { kind: 'firstPostInBoard'; board: string }
  | { kind: 'firstPostHere' }
  | { kind: 'profileBefore'; before: string }
  | { kind: 'arrivedBy'; via: ArrivalRoute }
  | { kind: 'byHand' };

export type TriggerParam = 'board' | 'before' | 'via';

/** The parameter each kind carries; null for the kinds that take none. */
export const TRIGGER_PARAM: Record<TriggerKind, TriggerParam | null> = {
  firstPostInBoard: 'board',
  firstPostHere: null,
  profileBefore: 'before',
  arrivedBy: 'via',
  byHand: null,
};

export const TRIGGER_KIND_LABELS: Record<TriggerKind, string> = {
  firstPostInBoard: 'first post in a board',
  firstPostHere: 'first post on this forum',
  profileBefore: 'profile created before a date',
  arrivedBy: 'how they arrived',
  byHand: 'awarded by hand',
};

const isKind = (value: unknown): value is TriggerKind => TRIGGER_KINDS.includes(value as TriggerKind);
const isRoute = (value: unknown): value is ArrivalRoute => ARRIVAL_ROUTES.includes(value as ArrivalRoute);

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export type TriggerResult = { ok: true; trigger: StampTrigger } | { ok: false; error: string };

/**
 * A trigger from record or form data. Strict: the kind's own parameter must be
 * present and valid, and no other parameter may be set. `boards` lists the
 * at-uris a firstPostInBoard trigger may point at.
 */
export function parseTrigger(
  kind: unknown,
  params: { board?: unknown; before?: unknown; via?: unknown } = {},
  boards: readonly string[] = [],
): TriggerResult {
  if (!isKind(kind)) return { ok: false, error: 'Choose what earns the stamp.' };
  const wanted = TRIGGER_PARAM[kind];
  for (const key of ['board', 'before', 'via'] as const) {
    if (key !== wanted && text(params[key])) {
      return { ok: false, error: `"${TRIGGER_KIND_LABELS[kind]}" doesn't take a ${key}.` };
    }
  }
  switch (kind) {
    case 'firstPostInBoard': {
      const board = text(params.board);
      if (!board) return { ok: false, error: 'Choose the board whose first post earns the stamp.' };
      if (!boards.includes(board)) return { ok: false, error: 'That board no longer exists.' };
      return { ok: true, trigger: { kind, board } };
    }
    case 'profileBefore': {
      const ms = Date.parse(text(params.before));
      if (Number.isNaN(ms)) return { ok: false, error: 'Enter the date a profile must predate.' };
      return { ok: true, trigger: { kind, before: new Date(ms).toISOString() } };
    }
    case 'arrivedBy': {
      const via = text(params.via);
      if (!isRoute(via)) return { ok: false, error: 'Choose how the member arrived: invite, application, or founding.' };
      return { ok: true, trigger: { kind, via } };
    }
    default:
      return { ok: true, trigger: { kind } };
  }
}

export interface StampFormFields {
  name?: unknown;
  symbol?: unknown;
  bg?: unknown;
  ink?: unknown;
  shape?: unknown;
  kind?: unknown;
  board?: unknown;
  before?: unknown;
  via?: unknown;
  /** Ticked to save a look the contrast check warned about. */
  confirm?: unknown;
}

/** The parts of a stamp record the admin form sets. */
export interface StampValue {
  name: string;
  look: StampLook;
  trigger: StampTrigger;
}

export type StampFormResult =
  | { ok: true; value: StampValue; warning?: string }
  | { ok: false; error: string; warning?: string };

/** A trimmed, single-spaced name of 1–24 graphemes, or an error. */
export function parseStampName(input: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = text(input).replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Give the stamp a name.' };
  if (graphemes(name) > STAMP_NAME_MAX_GRAPHEMES) {
    return { ok: false, error: `Stamp names can be at most ${STAMP_NAME_MAX_GRAPHEMES} characters.` };
  }
  return { ok: true, name };
}

/**
 * Validate a create/edit submission. A plain form sends every trigger control,
 * so only the parameter the chosen kind uses is read. Low contrast is a warning:
 * the value is held back until `confirm` is ticked, then saved with the warning.
 */
export function parseStampForm(fields: StampFormFields, boards: readonly string[] = []): StampFormResult {
  const name = parseStampName(fields.name);
  if (!name.ok) return name;
  const symbol = parseStampSymbol(fields.symbol);
  if (fields.symbol !== undefined && fields.symbol !== '' && !symbol) {
    return { ok: false, error: 'Choose one visible letter or emoji for the compact stamp, or leave it blank to use its initial.' };
  }
  const bg = normalizeBoardColor(fields.bg);
  const ink = normalizeBoardColor(fields.ink);
  if (!bg || !ink) return { ok: false, error: 'Background and ink must be six-digit hex colors such as #1a73e8.' };
  const look = parseLook({ bg, ink, shape: fields.shape, symbol });
  if (!look) return { ok: false, error: 'Choose one of the stamp shapes.' };
  const kind = text(fields.kind);
  const wanted = isKind(kind) ? TRIGGER_PARAM[kind] : null;
  const trigger = parseTrigger(kind, wanted ? { [wanted]: fields[wanted] } : {}, boards);
  if (!trigger.ok) return trigger;
  const value = { name: name.name, look, trigger: trigger.trigger };
  if (!isLowContrast(look)) return { ok: true, value };
  const ratio = contrastRatio(look.bg, look.ink);
  const warning = `Ink on background is ${ratio.toFixed(1)}:1, under the ${LOW_CONTRAST}:1 that stays legible at hovercard size.`;
  if (fields.confirm === 'on' || fields.confirm === true) return { ok: true, value, warning };
  return { ok: false, error: 'Tick "save anyway" to keep these colors.', warning };
}

/** A trigger as stored, read leniently: unknown kinds and missing parameters still describe. */
export interface StoredTrigger {
  kind: string;
  board?: string;
  before?: string;
  via?: string;
}

/**
 * Whether two triggers describe the same thing. The appview returns a trigger
 * as parsed JSON whose key order can differ from a locally built object, so a
 * plain `JSON.stringify` comparison isn't reliable; this compares field by
 * field instead.
 */
export function sameTrigger(a: StoredTrigger, b: StoredTrigger): boolean {
  return a.kind === b.kind && a.board === b.board && a.before === b.before && a.via === b.via;
}

/** True when a board trigger points at a board that is gone: the stamp reads as retired. */
export function retiredByDeletedBoard(trigger: StoredTrigger, boards: readonly string[]): boolean {
  return trigger.kind === 'firstPostInBoard' && !(trigger.board && boards.includes(trigger.board));
}

/** What earns a stamp, in words, for the admin list. */
export function triggerLabel(trigger: StoredTrigger, boardName?: string): string {
  switch (trigger.kind) {
    case 'firstPostInBoard':
      return `first post in ${boardName ?? 'a board that no longer exists'}`;
    case 'firstPostHere':
      return 'first post on this forum';
    case 'profileBefore':
      return `profile created before ${(trigger.before ?? '').slice(0, 10) || 'an unknown date'}`;
    case 'arrivedBy':
      return trigger.via === 'founding'
        ? 'founding member'
        : trigger.via === 'application'
          ? 'accepted by application'
          : trigger.via === 'invite'
            ? 'brought in by invite'
            : 'arrived by an unknown route';
    case 'byHand':
      return 'awarded by hand';
    default:
      return trigger.kind;
  }
}
