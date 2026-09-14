import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_VERSION,
  MAX_PENDING_ACTIONS,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  actionOutcome,
  clampHeight,
  createPanelBridge,
  parseFrameMessage,
  type ActionOutcome,
  type PanelBridgeOptions,
} from './bridge';

const THREAD = 'at://did:plc:author/app.atmobb.discussion.thread/3kgame';
const v = BRIDGE_VERSION;

describe('parseFrameMessage', () => {
  it('accepts the three frame messages in their exact shapes', () => {
    expect(parseFrameMessage({ type: 'atmobb:action', v, id: 1, action: 'move', input: { army: 'Paris' } }, 'thread')).toEqual({
      type: 'atmobb:action',
      v,
      id: 1,
      action: 'move',
      input: { army: 'Paris' },
    });
    expect(parseFrameMessage({ type: 'atmobb:action', v, id: 'a1', action: 'show' }, 'page')).toEqual({ type: 'atmobb:action', v, id: 'a1', action: 'show', input: null });
    expect(parseFrameMessage({ type: 'atmobb:resize', v, height: 320 }, 'thread')).toEqual({ type: 'atmobb:resize', v, height: 320 });
    expect(parseFrameMessage({ type: 'atmobb:attach', v, params: { players: 7 } }, 'attach')).toEqual({ type: 'atmobb:attach', v, params: { players: 7 } });
  });

  it('ignores anything that fails the schema', () => {
    const bad: unknown[] = [
      null,
      'atmobb:action',
      [],
      { type: 'atmobb:action', id: 1, action: 'move' }, // no version
      { type: 'atmobb:action', v: 2, id: 1, action: 'move' },
      { type: 'atmobb:action', v, action: 'move' },
      { type: 'atmobb:action', v, id: 1.5, action: 'move' },
      { type: 'atmobb:action', v, id: {}, action: 'move' },
      { type: 'atmobb:action', v, id: 'x'.repeat(65), action: 'move' },
      { type: 'atmobb:action', v, id: 1, action: '' },
      { type: 'atmobb:action', v, id: 1, action: 'x'.repeat(129) },
      { type: 'atmobb:action', v, id: 1, action: 7 },
      { type: 'atmobb:action', v, id: 1, action: 'move', input: { big: 'x'.repeat(70_000) } },
      { type: 'atmobb:action', v, id: 1, action: 'move', input: 1n },
      { type: 'atmobb:action', v, id: 1, action: 'move', extra: true },
      { type: 'atmobb:resize', v, height: '300' },
      { type: 'atmobb:resize', v, height: Number.NaN },
      { type: 'atmobb:resize', v, height: Number.POSITIVE_INFINITY },
      { type: 'atmobb:result', v, id: 1, ok: true, value: 1 },
      { type: 'atmobb:init', v, thread: null, signedIn: true },
      { type: 'atmobb:navigate', v, href: 'https://evil.test' },
    ];
    for (const data of bad) expect(parseFrameMessage(data, 'attach'), JSON.stringify(data, (_, x) => (typeof x === 'bigint' ? 'bigint' : x))).toBeNull();
  });

  it('accepts attach messages only in attach mode', () => {
    expect(parseFrameMessage({ type: 'atmobb:attach', v, params: {} }, 'thread')).toBeNull();
    expect(parseFrameMessage({ type: 'atmobb:attach', v, params: {} }, 'page')).toBeNull();
  });
});

describe('clampHeight', () => {
  it('keeps the panel between its minimum and maximum height', () => {
    expect(clampHeight(0)).toBe(PANEL_MIN_HEIGHT);
    expect(clampHeight(-500)).toBe(PANEL_MIN_HEIGHT);
    expect(clampHeight(320.6)).toBe(321);
    expect(clampHeight(1e9)).toBe(PANEL_MAX_HEIGHT);
  });
});

function harness(overrides: Partial<PanelBridgeOptions> = {}) {
  const frame = { postMessage: vi.fn() };
  const options: PanelBridgeOptions = {
    mode: 'thread',
    thread: THREAD,
    signedIn: true,
    path: '',
    frame: () => frame as unknown as Window,
    runAction: vi.fn(async (): Promise<ActionOutcome> => ({ ok: true, value: { count: 1 } })),
    resize: vi.fn(),
    teardown: vi.fn(),
    ...overrides,
  };
  const bridge = createPanelBridge(options);
  return { frame, options, bridge, posted: () => frame.postMessage.mock.calls.map(([message]) => message) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('actionOutcome', () => {
  it("delivers an extension's refusal as an error with its code and message", () => {
    expect(actionOutcome(422, { code: 'no_army', message: 'You have no army in Paris.' })).toEqual({
      ok: false,
      error: { code: 'no_army', message: 'You have no army in Paris.' },
    });
  });

  it('delivers the value of a successful action, and a generic error for an answer without one', () => {
    expect(actionOutcome(200, { value: { moved: true } })).toEqual({ ok: true, value: { moved: true } });
    expect(actionOutcome(200, {})).toEqual({ ok: true, value: null });
    expect(actionOutcome(502, null)).toEqual({ ok: false, error: { code: 'failed', message: 'The action failed.' } });
    expect(actionOutcome(429, { code: 7, message: ['x'] })).toEqual({ ok: false, error: { code: 'failed', message: 'The action failed.' } });
  });
});

describe('createPanelBridge', () => {
  it('sends the frame its init on the first load, to any origin since a sandboxed frame has none', () => {
    const { bridge, frame } = harness();
    bridge.load();
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'atmobb:init', v, mode: 'thread', thread: { uri: THREAD }, signedIn: true, path: '' }, '*');
  });

  it('forwards an action from its own frame and answers with the result', async () => {
    const { bridge, frame, options, posted } = harness();
    bridge.load();
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:action', v, id: 7, action: 'move', input: { army: 'Paris' } } });
    expect(options.runAction).toHaveBeenCalledExactlyOnceWith('move', { army: 'Paris' });
    await flush();
    expect(posted().at(-1)).toEqual({ type: 'atmobb:result', v, id: 7, ok: true, value: { count: 1 } });
  });

  it('answers a failed action with its error', async () => {
    const runAction = vi.fn(async (): Promise<ActionOutcome> => ({ ok: false, error: { code: 'rate_limited', message: 'Too many actions' } }));
    const { bridge, frame, posted } = harness({ runAction });
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:action', v, id: 'a', action: 'move' } });
    await flush();
    expect(posted().at(-1)).toEqual({ type: 'atmobb:result', v, id: 'a', ok: false, error: { code: 'rate_limited', message: 'Too many actions' } });
  });

  it('ignores messages from any window other than its own frame', () => {
    const { bridge, options } = harness();
    const other = { postMessage: vi.fn() } as unknown as Window;
    bridge.message({ source: other, data: { type: 'atmobb:action', v, id: 1, action: 'move' } });
    bridge.message({ source: null, data: { type: 'atmobb:resize', v, height: 300 } });
    expect(options.runAction).not.toHaveBeenCalled();
    expect(options.resize).not.toHaveBeenCalled();
  });

  it('ignores a message from its frame that fails the schema', () => {
    const { bridge, frame, options } = harness();
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:action', v, id: 1, action: 'move', viewer: { did: 'did:plc:forged' } } });
    expect(options.runAction).not.toHaveBeenCalled();
    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  it('clamps a resize', () => {
    const { bridge, frame, options } = harness();
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:resize', v, height: 99_999 } });
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:resize', v, height: 1 } });
    expect(vi.mocked(options.resize).mock.calls).toEqual([[PANEL_MAX_HEIGHT], [PANEL_MIN_HEIGHT]]);
  });

  it('tears the panel down on a second load, since that is the frame navigating itself, and goes quiet after', async () => {
    const { bridge, frame, options } = harness();
    bridge.load();
    bridge.load();
    expect(options.teardown).toHaveBeenCalledOnce();
    frame.postMessage.mockClear();
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:action', v, id: 1, action: 'move' } });
    bridge.load();
    await flush();
    expect(options.runAction).not.toHaveBeenCalled();
    expect(frame.postMessage).not.toHaveBeenCalled();
    expect(options.teardown).toHaveBeenCalledOnce();
  });

  it('drops a result that comes back after the panel was torn down', async () => {
    let finish!: (outcome: ActionOutcome) => void;
    const runAction = vi.fn(() => new Promise<ActionOutcome>((resolve) => (finish = resolve)));
    const { bridge, frame } = harness({ runAction });
    bridge.load();
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:action', v, id: 1, action: 'move' } });
    bridge.load();
    frame.postMessage.mockClear();
    finish({ ok: true, value: 1 });
    await flush();
    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  it('refuses actions past the pending cap until earlier ones finish', async () => {
    const finishers: ((outcome: ActionOutcome) => void)[] = [];
    const runAction = vi.fn(() => new Promise<ActionOutcome>((resolve) => finishers.push(resolve)));
    const { bridge, frame, posted } = harness({ runAction });
    for (let id = 0; id <= MAX_PENDING_ACTIONS; id++) bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:action', v, id, action: 'move' } });
    expect(runAction).toHaveBeenCalledTimes(MAX_PENDING_ACTIONS);
    expect(posted()).toEqual([{ type: 'atmobb:result', v, id: MAX_PENDING_ACTIONS, ok: false, error: { code: 'busy', message: expect.any(String) } }]);
    finishers[0]({ ok: true, value: null });
    await flush();
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:action', v, id: 'next', action: 'move' } });
    expect(runAction).toHaveBeenCalledTimes(MAX_PENDING_ACTIONS + 1);
  });

  it('hands attach params to the page in attach mode, with the mode and thread in init', () => {
    const attach = vi.fn();
    const { bridge, frame } = harness({ mode: 'attach', attach });
    bridge.load();
    expect(frame.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'atmobb:init', mode: 'attach', thread: { uri: THREAD } }), '*');
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:attach', v, params: { players: 7 } } });
    expect(attach).toHaveBeenCalledExactlyOnceWith({ players: 7 });
  });

  it('tells a standalone page its path and no thread', () => {
    const { bridge, frame } = harness({ mode: 'page', thread: null, signedIn: false, path: 'games/spring-1901' });
    bridge.load();
    expect(frame.postMessage).toHaveBeenCalledWith({ type: 'atmobb:init', v, mode: 'page', thread: null, signedIn: false, path: 'games/spring-1901' }, '*');
  });
});
