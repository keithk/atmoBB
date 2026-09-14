import type { ThreadRef } from './contract';

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
export type FrameMessage = ActionMessage | ResizeMessage | AttachMessage;

// Page to frame.

/** Sent once the frame has loaded. */
export interface InitMessage {
  type: 'atmobb:init';
  v: typeof BRIDGE_VERSION;
  mode: PanelMode;
  thread: ThreadRef | null;
  signedIn: boolean;
  /** On the extension's own page, the path after its page address; otherwise empty. */
  path: string;
}
export interface BridgeError {
  code: string;
  message: string;
}
export type ActionOutcome = { ok: true; value: unknown } | { ok: false; error: BridgeError };
/** The answer to one action message, matched by its id. */
export type ResultMessage = { type: 'atmobb:result'; v: typeof BRIDGE_VERSION; id: MessageId } & ActionOutcome;
export type HostMessage = InitMessage | ResultMessage;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnly = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));

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
    default:
      return null;
  }
}

export const clampHeight = (height: number) => Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, Math.round(height)));

export interface PanelBridgeOptions {
  mode: PanelMode;
  /** The bound thread's at-uri, or null outside a thread. */
  thread: string | null;
  signedIn: boolean;
  path: string;
  /** The panel's own frame window, or null while it has none. */
  frame: () => Window | null;
  runAction: (action: string, input: unknown) => Promise<ActionOutcome>;
  /** Attach mode only. */
  attach?: (params: unknown) => void;
  resize: (height: number) => void;
  /** Remove the frame. Called at most once. */
  teardown: () => void;
}

export interface PanelBridge {
  /** Call on each of the frame's load events. */
  load(): void;
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
      post({
        type: 'atmobb:init',
        v: BRIDGE_VERSION,
        mode: options.mode,
        thread: options.thread ? { uri: options.thread } : null,
        signedIn: options.signedIn,
        path: options.path,
      });
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
