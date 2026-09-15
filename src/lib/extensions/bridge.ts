import { isObject, type ThreadRef } from './contract';

// The messages an extension's panel and the forum page trade over
// postMessage. The panel runs in a frame sandboxed to an opaque origin, so the
// page can't tell it apart by origin; it takes messages only from its own
// frame's window, and only in these exact shapes. Every message carries the
// bridge version as `v`. The authoring kit's template speaks this schema, so
// nothing here may import browser- or server-only code.

export const BRIDGE_VERSION = 1;

/** Panel heights, in CSS pixels, a resize is clamped to. */
export const PANEL_MIN_HEIGHT = 48;
export const PANEL_MAX_HEIGHT = 2400;

export const MAX_ACTION_NAME_LENGTH = 128;
export const MAX_MESSAGE_ID_LENGTH = 64;
/** Largest action input or attach params, as JSON. */
export const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Actions one panel may have waiting on the server at once. */
export const MAX_PENDING_ACTIONS = 8;

export const MAX_LINK_PAGE_LENGTH = 512;
export const MAX_LINK_LABEL_LENGTH = 80;

/** Most DIDs and handles one names message may ask about. */
export const MAX_NAME_DIDS = 100;
export const MAX_NAME_HANDLES = 20;

/** Where the panel is shown: on a bound thread, on the extension's own page, or on the staff attach page. */
export type PanelMode = 'thread' | 'page' | 'attach';

export type MessageId = string | number;

// Frame to page.

/** Run the extension's `action` handler as the viewing member. */
export interface ActionMessage {
  type: 'atmobb:action';
  v: typeof BRIDGE_VERSION;
  id: MessageId;
  action: string;
  input: unknown;
}
/** Ask for the frame to be this tall. */
export interface ResizeMessage {
  type: 'atmobb:resize';
  v: typeof BRIDGE_VERSION;
  height: number;
}
/** The attach page only: attach the extension to the thread with this setup. */
export interface AttachMessage {
  type: 'atmobb:attach';
  v: typeof BRIDGE_VERSION;
  params: unknown;
}
/**
 * A standalone page only: the records shown come from this DID's repo. The
 * page resolves it and labels the source outside the frame, where the panel
 * can't forge it. A later source replaces an earlier one.
 */
export interface SourceMessage {
  type: 'atmobb:source';
  v: typeof BRIDGE_VERSION;
  did: string;
}
/**
 * Thread and page modes only: point a link at a page of the extension's own
 * standalone pages, drawn outside the frame next to the panel where a link
 * inside the sandbox can't reach — following one there would just navigate
 * the frame and close the panel. `page` is the part of the address after
 * `<pageBase>/-/`. An empty `page` clears a link shown before; `label` is
 * ignored then. A later link message replaces the one before it.
 */
export interface LinkMessage {
  type: 'atmobb:link';
  v: typeof BRIDGE_VERSION;
  page: string;
  label: string;
}
/**
 * Every mode: ask who people are. The panel knows people only by DID and can't
 * reach the network, so the page looks the names up and answers with a
 * names-result carrying the same id. Either list may be left out, but not both.
 */
export interface NamesMessage {
  type: 'atmobb:names';
  v: typeof BRIDGE_VERSION;
  id: MessageId;
  /** DIDs to name. */
  dids: string[];
  /** Handles to find the DIDs of, with or without a leading `@`. */
  handles: string[];
}
export type FrameMessage = ActionMessage | ResizeMessage | AttachMessage | SourceMessage | LinkMessage | NamesMessage;

// Page to frame.

/** The forum's colors a panel can match, each named for what it's for rather than for the forum token it comes from. */
export const THEME_COLORS = [
  'ground',
  'surface',
  'surfaceAlt',
  'sunken',
  'line',
  'lineStrong',
  'ink',
  'inkSoft',
  'inkFaint',
  'accent',
  'accentHover',
  'accentInk',
  'accentSoft',
  'link',
  'linkHover',
  'ok',
  'okSoft',
  'warn',
  'warnSoft',
  'danger',
  'dangerSoft',
] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];
/** The forum's font roles a panel can match. */
export const THEME_FONTS = ['body', 'display', 'mono'] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];

/**
 * How the forum page looks right now: whether it's showing light or dark, and
 * whichever of its colors (CSS colors) and fonts (font-family lists) passed
 * validation. A name the forum couldn't supply a valid value for is left out.
 */
export interface PanelTheme {
  scheme: 'light' | 'dark';
  colors: Partial<Record<ThemeColor, string>>;
  fonts: Partial<Record<ThemeFont, string>>;
}

/** Sent once the frame has loaded. */
export interface InitMessage {
  type: 'atmobb:init';
  v: typeof BRIDGE_VERSION;
  mode: PanelMode;
  thread: ThreadRef | null;
  signedIn: boolean;
  /** On the extension's own page, the path after its page address; otherwise empty. */
  path: string;
  /** The extension's standalone page address, `/ext/<repository>`, which outlives a reinstall. */
  pageBase: string;
  theme: PanelTheme;
}
/** Sent when the forum's theme changes while the panel is open, in the same shape as init's. */
export interface ThemeMessage {
  type: 'atmobb:theme';
  v: typeof BRIDGE_VERSION;
  theme: PanelTheme;
}
export interface BridgeError {
  code: string;
  message: string;
}
export type ActionOutcome = { ok: true; value: unknown } | { ok: false; error: BridgeError };
/** The answer to one action message, matched by its id. */
export type ResultMessage = { type: 'atmobb:result'; v: typeof BRIDGE_VERSION; id: MessageId } & ActionOutcome;
/** What a panel may call a person: a handle verified to resolve back to their DID, and their display name on this forum when they have one. */
export interface PersonName {
  handle: string;
  displayName?: string;
}
export interface NamesAnswer {
  /** Each DID asked about, null when it has no verified handle or couldn't be looked up. */
  names: Record<string, PersonName | null>;
  /** Each handle asked about, exactly as asked, to the DID it verifiably belongs to, or null. */
  dids: Record<string, string | null>;
}
/** The answer to one names message, matched by its id. */
export type NamesResultMessage = { type: 'atmobb:names-result'; v: typeof BRIDGE_VERSION; id: MessageId } & NamesAnswer;
export type HostMessage = InitMessage | ThemeMessage | ResultMessage | NamesResultMessage;

const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));

const validId = (id: unknown): id is MessageId =>
  (typeof id === 'string' && id.length <= MAX_MESSAGE_ID_LENGTH) || Number.isSafeInteger(id);

/** Whether a payload is JSON no bigger than the cap. Absent counts as null. */
function jsonPayload(value: unknown): boolean {
  if (value === undefined) return true;
  try {
    const text = JSON.stringify(value);
    return text !== undefined && new TextEncoder().encode(text).byteLength <= MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

export const MAX_DID_LENGTH = 2048;
// atproto's DID syntax: a lowercase method, then an identifier that doesn't end in a colon or percent sign.
const DID_SYNTAX = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;

export const isDid = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_DID_LENGTH && DID_SYNTAX.test(value);

export const MAX_HANDLE_LENGTH = 253;
// atproto's handle syntax: dot-separated labels of letters, digits, and inner hyphens, the last starting with a letter.
const HANDLE_SYNTAX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

/** Whether `value` is a handle, with or without a leading `@`. */
export const isHandle = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const handle = value.startsWith('@') ? value.slice(1) : value;
  return handle.length <= MAX_HANDLE_LENGTH && HANDLE_SYNTAX.test(handle);
};

const isList = (value: unknown, max: number, valid: (entry: unknown) => entry is string): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((entry) => valid(entry));

// A page path stays relative, inside a safe character set, and never climbs
// out of the extension's own pages: no scheme or host (`:` and `/` are
// allowed characters, but `//` is how both `https://` and `//host` smuggle
// one in), no `..` segment, and no backslashes.
const LINK_PAGE_SYNTAX = /^[A-Za-z0-9._~:@%+\-/]+$/;
// A `.` or `..` segment, written literally or percent-encoded (`%2e`), in any mix of the two.
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

const isValidLinkPage = (page: string): boolean =>
  page.length > 0 &&
  page.length <= MAX_LINK_PAGE_LENGTH &&
  LINK_PAGE_SYNTAX.test(page) &&
  !page.startsWith('/') &&
  !page.includes('//') &&
  !page.split('/').some((segment) => DOT_SEGMENT.test(segment));

export const MAX_THEME_VALUE_LENGTH = 256;

// Only the characters colors are written with, so a value can't end its
// declaration or open a block, and no function that reaches outside the value.
const COLOR_SYNTAX = /^[A-Za-z0-9#(),.%\s/+-]+$/;
const COLOR_REFERENCE = /(?:url|var|env|attr|image)\(/i;

/** Whether `value` is a CSS color: in a safe character set and, where the browser can say, one it parses as a color. */
export const isThemeColor = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_THEME_VALUE_LENGTH &&
  COLOR_SYNTAX.test(value) &&
  !COLOR_REFERENCE.test(value) &&
  (typeof CSS === 'undefined' || CSS.supports('color', value));

const GENERIC_FAMILIES = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'math', 'emoji', 'fangsong', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'];
const QUOTED_FAMILY = /^(?:'[A-Za-z0-9 ._-]{1,64}'|"[A-Za-z0-9 ._-]{1,64}")$/;

/** Whether `value` is a font-family list made only of quoted family names and generic families. */
export const isFontList = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_THEME_VALUE_LENGTH &&
  value.split(',').every((family) => QUOTED_FAMILY.test(family.trim()) || GENERIC_FAMILIES.includes(family.trim()));

/** The theme `value` is, or null for anything outside the schema: an unknown key, a scheme other than light or dark, or any invalid color or font list. */
export function parseTheme(value: unknown): PanelTheme | null {
  if (!isObject(value) || !hasOnly(value, ['scheme', 'colors', 'fonts'])) return null;
  const { scheme, colors, fonts } = value;
  if ((scheme !== 'light' && scheme !== 'dark') || !isObject(colors) || !isObject(fonts)) return null;
  if (!hasOnly(colors, THEME_COLORS) || !Object.values(colors).every(isThemeColor)) return null;
  if (!hasOnly(fonts, THEME_FONTS) || !Object.values(fonts).every(isFontList)) return null;
  return { scheme, colors: { ...colors }, fonts: { ...fonts } };
}

/** The frame message `data` is, or null for anything outside the schema or not allowed in `mode`. */
export function parseFrameMessage(data: unknown, mode: PanelMode): FrameMessage | null {
  if (!isObject(data) || data.v !== BRIDGE_VERSION) return null;
  switch (data.type) {
    case 'atmobb:action': {
      const { id, action, input } = data;
      if (!hasOnly(data, ['type', 'v', 'id', 'action', 'input']) || !validId(id)) return null;
      if (typeof action !== 'string' || !action || action.length > MAX_ACTION_NAME_LENGTH || !jsonPayload(input)) return null;
      return { type: 'atmobb:action', v: BRIDGE_VERSION, id, action, input: input ?? null };
    }
    case 'atmobb:resize': {
      const { height } = data;
      if (!hasOnly(data, ['type', 'v', 'height']) || typeof height !== 'number' || !Number.isFinite(height)) return null;
      return { type: 'atmobb:resize', v: BRIDGE_VERSION, height };
    }
    case 'atmobb:attach': {
      const { params } = data;
      if (mode !== 'attach' || !hasOnly(data, ['type', 'v', 'params']) || !jsonPayload(params)) return null;
      return { type: 'atmobb:attach', v: BRIDGE_VERSION, params: params ?? null };
    }
    case 'atmobb:source': {
      const { did } = data;
      if (mode !== 'page' || !hasOnly(data, ['type', 'v', 'did']) || !isDid(did)) return null;
      return { type: 'atmobb:source', v: BRIDGE_VERSION, did };
    }
    case 'atmobb:link': {
      const { page, label } = data;
      if (mode === 'attach' || !hasOnly(data, ['type', 'v', 'page', 'label']) || typeof page !== 'string') return null;
      if (page === '') return { type: 'atmobb:link', v: BRIDGE_VERSION, page: '', label: '' };
      if (!isValidLinkPage(page) || typeof label !== 'string') return null;
      const trimmedLabel = label.trim();
      if (!trimmedLabel || trimmedLabel.length > MAX_LINK_LABEL_LENGTH) return null;
      return { type: 'atmobb:link', v: BRIDGE_VERSION, page, label: trimmedLabel };
    }
    case 'atmobb:names': {
      const { id, dids = [], handles = [] } = data;
      if (!hasOnly(data, ['type', 'v', 'id', 'dids', 'handles']) || !validId(id)) return null;
      if (!isList(dids, MAX_NAME_DIDS, isDid) || !isList(handles, MAX_NAME_HANDLES, isHandle) || (!dids.length && !handles.length)) return null;
      return { type: 'atmobb:names', v: BRIDGE_VERSION, id, dids: [...dids], handles: [...handles] };
    }
    default:
      return null;
  }
}

/**
 * The outcome to answer a panel with, from the action endpoint's status and
 * JSON body: the handler's value, or the error code and message the endpoint
 * refused with, which is the extension's own when it refused the action.
 */
export function actionOutcome(status: number, body: unknown): ActionOutcome {
  const answer = isObject(body) ? body : {};
  if (status >= 200 && status < 300) return { ok: true, value: answer.value ?? null };
  return {
    ok: false,
    error: {
      code: typeof answer.code === 'string' ? answer.code : 'failed',
      message: typeof answer.message === 'string' ? answer.message : 'The action failed.',
    },
  };
}

const personName = (value: unknown): PersonName | null => {
  if (!isObject(value) || !isHandle(value.handle) || value.handle.startsWith('@')) return null;
  return typeof value.displayName === 'string' && value.displayName ? { handle: value.handle, displayName: value.displayName } : { handle: value.handle };
};

/**
 * The names to answer a panel with, from the names endpoint's status and JSON
 * body: an entry for exactly the DIDs and handles asked about, null for each
 * the endpoint didn't resolve, and null for all of them when it refused.
 */
export function namesFromResponse(dids: string[], handles: string[], status: number, body: unknown): NamesAnswer {
  const answer = status === 200 && isObject(body) ? body : {};
  const names = isObject(answer.names) ? answer.names : {};
  const found = isObject(answer.dids) ? answer.dids : {};
  return {
    names: Object.fromEntries(dids.map((did) => [did, Object.hasOwn(names, did) ? personName(names[did]) : null])),
    dids: Object.fromEntries(handles.map((handle) => [handle, Object.hasOwn(found, handle) && isDid(found[handle]) ? found[handle] : null])),
  };
}

export const clampHeight = (height: number) => Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, Math.round(height)));

export interface PanelBridgeOptions {
  mode: PanelMode;
  /** The bound thread's at-uri, or null outside a thread. */
  thread: string | null;
  signedIn: boolean;
  path: string;
  pageBase: string;
  /** The panel's own frame window, or null while it has none. */
  frame: () => Window | null;
  runAction: (action: string, input: unknown) => Promise<ActionOutcome>;
  /** Attach mode only. */
  attach?: (params: unknown) => void;
  /** Page mode only: the DID whose repo the shown records come from. */
  source?: (did: string) => void;
  /** Thread and page modes only: a link to a page of the extension's own, or '' to clear it. */
  link?: (page: string, label: string) => void;
  /** Who the DIDs are and whose the handles are. */
  names: (dids: string[], handles: string[]) => Promise<NamesAnswer>;
  /** How the forum page looks right now. */
  theme: () => PanelTheme;
  resize: (height: number) => void;
  /** Remove the frame. Called at most once. */
  teardown: () => void;
}

export interface PanelBridge {
  /** Call on each of the frame's load events. */
  load(): void;
  /** Call when the forum's theme may have changed. The frame hears of it only when it did. */
  theme(): void;
  /** Call with each message event the page's window receives. */
  message(event: Pick<MessageEvent, 'source' | 'data'>): void;
  /** Stop answering, for when the panel unmounts. */
  close(): void;
}

/**
 * The page side of one panel. The frame's first load gets the init message; a
 * second load means the frame navigated itself somewhere, so the panel is torn
 * down and nothing more is sent to or taken from that window.
 */
export function createPanelBridge(options: PanelBridgeOptions): PanelBridge {
  let loads = 0;
  let closed = false;
  let pending = 0;
  let sentTheme = '';

  // A theme that fails the schema is never sent; the panel gets no colors or fonts instead.
  const currentTheme = (): PanelTheme => parseTheme(options.theme()) ?? { scheme: 'light', colors: {}, fonts: {} };

  // A sandboxed frame's origin is opaque, so no target origin but '*' reaches it.
  const post = (message: HostMessage) => {
    if (!closed) options.frame()?.postMessage(message, '*');
  };

  const answer = (id: MessageId, outcome: ActionOutcome) => post({ type: 'atmobb:result', v: BRIDGE_VERSION, id, ...outcome });

  return {
    load() {
      if (closed) return;
      if (++loads > 1) {
        closed = true;
        options.teardown();
        return;
      }
      const theme = currentTheme();
      sentTheme = JSON.stringify(theme);
      post({
        type: 'atmobb:init',
        v: BRIDGE_VERSION,
        mode: options.mode,
        thread: options.thread ? { uri: options.thread } : null,
        signedIn: options.signedIn,
        path: options.path,
        pageBase: options.pageBase,
        theme,
      });
    },

    theme() {
      // Before the first load, init will carry whatever the theme is by then.
      if (closed || loads === 0) return;
      const theme = currentTheme();
      const text = JSON.stringify(theme);
      if (text === sentTheme) return;
      sentTheme = text;
      post({ type: 'atmobb:theme', v: BRIDGE_VERSION, theme });
    },

    message(event) {
      const frame = options.frame();
      if (closed || !frame || event.source !== frame) return;
      const message = parseFrameMessage(event.data, options.mode);
      if (!message) return;
      switch (message.type) {
        case 'atmobb:resize':
          options.resize(clampHeight(message.height));
          return;
        case 'atmobb:attach':
          options.attach?.(message.params);
          return;
        case 'atmobb:source':
          options.source?.(message.did);
          return;
        case 'atmobb:link':
          options.link?.(message.page, message.label);
          return;
        case 'atmobb:names':
          options
            .names(message.dids, message.handles)
            .catch(() => namesFromResponse(message.dids, message.handles, 0, null))
            .then((answer) => post({ type: 'atmobb:names-result', v: BRIDGE_VERSION, id: message.id, ...answer }));
          return;
        case 'atmobb:action': {
          if (pending >= MAX_PENDING_ACTIONS) {
            answer(message.id, { ok: false, error: { code: 'busy', message: 'Too many actions are already waiting. Try again when they finish.' } });
            return;
          }
          pending++;
          options
            .runAction(message.action, message.input)
            .catch((): ActionOutcome => ({ ok: false, error: { code: 'network', message: "Couldn't reach the forum. Try again." } }))
            .then((outcome) => {
              pending--;
              answer(message.id, outcome);
            });
        }
      }
    },

    close() {
      closed = true;
    },
  };
}
