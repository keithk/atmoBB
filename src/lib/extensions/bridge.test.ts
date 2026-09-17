import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_VERSION,
  MAX_NAME_DIDS,
  MAX_NAME_HANDLES,
  MAX_PENDING_ACTIONS,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  actionOutcome,
  clampHeight,
  createPanelBridge,
  isFontList,
  isThemeColor,
  namesFromResponse,
  parseFrameMessage,
  parseTheme,
  type ActionOutcome,
  type NamesAnswer,
  type PanelBridgeOptions,
  type PanelTheme,
} from './bridge';

const THREAD = 'at://did:plc:author/app.atmobb.discussion.thread/3kgame';
const KEITH = 'did:plc:5qartdsce62n2wfyvtocmoob';
const JACK = 'did:plc:dvh42fok55dox6pzlyevelz6';
const v = BRIDGE_VERSION;
const THEME: PanelTheme = {
  scheme: 'light',
  colors: { ground: '#eceae7', surface: '#ffffff', accent: '#f79b7a', accentInk: '#4a2a1c', okSoft: 'rgba(224, 239, 228, 0.9)' },
  fonts: { body: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif", mono: '"IBM Plex Mono", ui-monospace, monospace' },
};

describe('parseFrameMessage', () => {
  it('accepts the frame messages in their exact shapes', () => {
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

  it('accepts a source message only on a standalone page, naming a DID in exactly that shape', () => {
    const did = 'did:plc:dvh42fok55dox6pzlyevelz6';
    expect(parseFrameMessage({ type: 'atmobb:source', v, did }, 'page')).toEqual({ type: 'atmobb:source', v, did });
    expect(parseFrameMessage({ type: 'atmobb:source', v, did: 'did:web:forum.example.com' }, 'page')).toEqual({ type: 'atmobb:source', v, did: 'did:web:forum.example.com' });
    expect(parseFrameMessage({ type: 'atmobb:source', v, did }, 'thread')).toBeNull();
    expect(parseFrameMessage({ type: 'atmobb:source', v, did }, 'attach')).toBeNull();
    const bad: unknown[] = [
      { type: 'atmobb:source', v, did, handle: 'atmobb.app' },
      { type: 'atmobb:source', v },
      { type: 'atmobb:source', v, did: 7 },
      { type: 'atmobb:source', v, did: '' },
      { type: 'atmobb:source', v, did: 'atmobb.app' },
      { type: 'atmobb:source', v, did: 'did:plc:' },
      { type: 'atmobb:source', v, did: 'DID:plc:abc' },
      { type: 'atmobb:source', v, did: 'did:plc:abc:' },
      { type: 'atmobb:source', v, did: 'did:plc:a b' },
      { type: 'atmobb:source', v, did: `did:plc:${'a'.repeat(2048)}` },
      { type: 'atmobb:source', v: 2, did },
    ];
    for (const data of bad) expect(parseFrameMessage(data, 'page'), JSON.stringify(data)).toBeNull();
  });

  it('accepts attach messages only in attach mode', () => {
    expect(parseFrameMessage({ type: 'atmobb:attach', v, params: {} }, 'thread')).toBeNull();
    expect(parseFrameMessage({ type: 'atmobb:attach', v, params: {} }, 'page')).toBeNull();
  });

  it('accepts a link message in thread and page modes, trimming the label, but not in attach mode', () => {
    expect(parseFrameMessage({ type: 'atmobb:link', v, page: 'games/spring-1901', label: '  Replay board  ' }, 'thread')).toEqual({
      type: 'atmobb:link',
      v,
      page: 'games/spring-1901',
      label: 'Replay board',
    });
    expect(parseFrameMessage({ type: 'atmobb:link', v, page: 'games/spring-1901', label: 'Replay board' }, 'page')).toEqual({
      type: 'atmobb:link',
      v,
      page: 'games/spring-1901',
      label: 'Replay board',
    });
    expect(parseFrameMessage({ type: 'atmobb:link', v, page: 'games/spring-1901', label: 'Replay board' }, 'attach')).toBeNull();
  });

  it('clears a link with an empty page, ignoring whatever label came with it', () => {
    expect(parseFrameMessage({ type: 'atmobb:link', v, page: '', label: '' }, 'thread')).toEqual({ type: 'atmobb:link', v, page: '', label: '' });
    expect(parseFrameMessage({ type: 'atmobb:link', v, page: '' }, 'page')).toEqual({ type: 'atmobb:link', v, page: '', label: '' });
    expect(parseFrameMessage({ type: 'atmobb:link', v, page: '', label: 'ignored, even if too long: ' + 'x'.repeat(90) }, 'page')).toEqual({ type: 'atmobb:link', v, page: '', label: '' });
  });

  it('refuses a link page that could escape the extension or a bad label', () => {
    const bad: unknown[] = [
      { type: 'atmobb:link', v, page: 'https://evil.test', label: 'Go' },
      { type: 'atmobb:link', v, page: '//evil.test', label: 'Go' },
      { type: 'atmobb:link', v, page: '../x', label: 'Go' },
      { type: 'atmobb:link', v, page: 'a/../x', label: 'Go' },
      { type: 'atmobb:link', v, page: '%2e%2e/x', label: 'Go' },
      { type: 'atmobb:link', v, page: 'a/%2E./x', label: 'Go' },
      { type: 'atmobb:link', v, page: '/abs', label: 'Go' },
      { type: 'atmobb:link', v, page: 'a\\b', label: 'Go' },
      { type: 'atmobb:link', v, page: 'x'.repeat(513), label: 'Go' },
      { type: 'atmobb:link', v, page: 'games', label: 'Go', extra: true },
      { type: 'atmobb:link', v, page: 'games', label: 7 },
      { type: 'atmobb:link', v, page: 'games', label: '' },
      { type: 'atmobb:link', v, page: 'games', label: '   ' },
      { type: 'atmobb:link', v, page: 'games', label: 'x'.repeat(81) },
      { type: 'atmobb:link', v, page: 7, label: 'Go' },
    ];
    for (const data of bad) expect(parseFrameMessage(data, 'thread'), JSON.stringify(data)).toBeNull();
  });

  it('accepts a names message in every mode, with either list left out but not both', () => {
    const message = { type: 'atmobb:names', v, id: 3, dids: [KEITH, JACK], handles: ['@keith.is', 'Jack.Example.com'] };
    for (const mode of ['thread', 'page', 'attach'] as const) expect(parseFrameMessage(message, mode)).toEqual(message);
    expect(parseFrameMessage({ type: 'atmobb:names', v, id: 'n', dids: [KEITH] }, 'thread')).toEqual({ type: 'atmobb:names', v, id: 'n', dids: [KEITH], handles: [] });
    expect(parseFrameMessage({ type: 'atmobb:names', v, id: 'n', handles: ['keith.is'] }, 'attach')).toEqual({ type: 'atmobb:names', v, id: 'n', dids: [], handles: ['keith.is'] });
    const most = { type: 'atmobb:names', v, id: 1, dids: Array.from({ length: MAX_NAME_DIDS }, () => KEITH), handles: Array.from({ length: MAX_NAME_HANDLES }, () => 'keith.is') };
    expect(parseFrameMessage(most, 'page')).toEqual(most);
  });

  it('refuses a names message with too many entries, a malformed one, or nothing to ask', () => {
    const bad: unknown[] = [
      { type: 'atmobb:names', v, id: 1 },
      { type: 'atmobb:names', v, id: 1, dids: [], handles: [] },
      { type: 'atmobb:names', v, dids: [KEITH] },
      { type: 'atmobb:names', v, id: 1.5, dids: [KEITH] },
      { type: 'atmobb:names', v: 2, id: 1, dids: [KEITH] },
      { type: 'atmobb:names', v, id: 1, dids: [KEITH], extra: true },
      { type: 'atmobb:names', v, id: 1, dids: Array.from({ length: MAX_NAME_DIDS + 1 }, () => KEITH) },
      { type: 'atmobb:names', v, id: 1, handles: Array.from({ length: MAX_NAME_HANDLES + 1 }, () => 'keith.is') },
      { type: 'atmobb:names', v, id: 1, dids: KEITH },
      { type: 'atmobb:names', v, id: 1, dids: { 0: KEITH, length: 1 } },
      { type: 'atmobb:names', v, id: 1, dids: [KEITH, 'keith.is'] },
      { type: 'atmobb:names', v, id: 1, dids: [KEITH, null] },
      { type: 'atmobb:names', v, id: 1, handles: 'keith.is' },
      { type: 'atmobb:names', v, id: 1, handles: [KEITH] },
      { type: 'atmobb:names', v, id: 1, handles: ['@@keith.is'] },
      { type: 'atmobb:names', v, id: 1, handles: ['keith'] },
      { type: 'atmobb:names', v, id: 1, handles: ['keith .is'] },
      { type: 'atmobb:names', v, id: 1, handles: ['keith.1s'] },
      { type: 'atmobb:names', v, id: 1, handles: [`${'a'.repeat(63)}.`.repeat(4) + 'is'] },
      { type: 'atmobb:names', v, id: 1, handles: [7] },
    ];
    for (const data of bad) expect(parseFrameMessage(data, 'thread'), JSON.stringify(data)).toBeNull();
  });
});

describe('namesFromResponse', () => {
  it('answers exactly what was asked, dropping anything malformed or extra', () => {
    const body = {
      names: { [KEITH]: { handle: 'keith.is', displayName: 'Keith', extra: 1 }, [JACK]: { handle: '@jack.example.com' }, 'did:plc:other': { handle: 'other.example.com' } },
      dids: { '@keith.is': KEITH, 'jack.example.com': 'jack', 'other.example.com': KEITH },
    };
    expect(namesFromResponse([KEITH, JACK], ['@keith.is', 'jack.example.com'], 200, body)).toEqual({
      names: { [KEITH]: { handle: 'keith.is', displayName: 'Keith' }, [JACK]: null },
      dids: { '@keith.is': KEITH, 'jack.example.com': null },
    });
  });

  it('answers null for everything asked when the endpoint refused', () => {
    expect(namesFromResponse([KEITH], ['keith.is'], 429, { code: 'rate_limited', names: { [KEITH]: { handle: 'keith.is' } } })).toEqual({ names: { [KEITH]: null }, dids: { 'keith.is': null } });
    expect(namesFromResponse([KEITH], [], 200, null)).toEqual({ names: { [KEITH]: null }, dids: {} });
  });
});

describe('parseTheme', () => {
  it('accepts a theme in its exact shape, in either scheme, with any names left out', () => {
    expect(parseTheme(THEME)).toEqual(THEME);
    expect(parseTheme({ ...THEME, scheme: 'dark' })).toEqual({ ...THEME, scheme: 'dark' });
    expect(parseTheme({ scheme: 'dark', colors: {}, fonts: {} })).toEqual({ scheme: 'dark', colors: {}, fonts: {} });
    expect(parseTheme({ scheme: 'light', colors: { ink: 'light-dark(#2b2a2e, #ecebf3)', line: 'oklch(0.9 0.01 60 / 50%)' }, fonts: {} })).not.toBeNull();
  });

  it('refuses a theme with an unknown key, a bad scheme, an invalid color, or a bad font list', () => {
    const bad: unknown[] = [
      null,
      [],
      { scheme: 'light', colors: {} },
      { ...THEME, css: 'body{}' },
      { ...THEME, scheme: 'dim' },
      { ...THEME, scheme: 'light dark' },
      { ...THEME, scheme: undefined },
      { ...THEME, colors: [] },
      { ...THEME, fonts: null },
      { ...THEME, colors: { background: '#fff' } },
      { ...THEME, fonts: { serif: 'serif' } },
      { ...THEME, colors: { ground: 7 } },
      { ...THEME, colors: { ground: '' } },
      { ...THEME, colors: { ground: '#fff; background: red' } },
      { ...THEME, colors: { ground: '#fff}body{color:red' } },
      { ...THEME, colors: { ground: 'url(/x/other/frame/track.png)' } },
      { ...THEME, colors: { ground: 'var(--forum-bg)' } },
      { ...THEME, colors: { ground: '"red"' } },
      { ...THEME, colors: { ground: 'red\\,blue' } },
      { ...THEME, colors: { ground: `#${'f'.repeat(300)}` } },
      { ...THEME, fonts: { body: '' } },
      { ...THEME, fonts: { body: 'Georgia, serif' } },
      { ...THEME, fonts: { body: "'IBM Plex Sans', " } },
      { ...THEME, fonts: { body: "'Plex'; src: url(x)" } },
      { ...THEME, fonts: { body: "'Plex\\27 ', serif" } },
      { ...THEME, fonts: { body: `'${'x'.repeat(65)}', serif` } },
      { ...THEME, fonts: { body: "'Plex\", serif" } },
    ];
    for (const theme of bad) expect(parseTheme(theme), JSON.stringify(theme)).toBeNull();
  });

  it("checks colors with the browser's own parser where there is one", () => {
    const supports = vi.fn((_property: string, value: string) => value !== 'notacolor');
    vi.stubGlobal('CSS', { supports });
    try {
      expect(isThemeColor('#fff')).toBe(true);
      expect(isThemeColor('notacolor')).toBe(false);
      expect(supports).toHaveBeenCalledWith('color', 'notacolor');
      expect(parseTheme({ ...THEME, colors: { ground: 'notacolor' } })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('takes font lists of quoted names and generic families only', () => {
    expect(isFontList("'Trebuchet MS', 'IBM Plex Sans', system-ui, sans-serif")).toBe(true);
    expect(isFontList('ui-monospace,monospace')).toBe(true);
    expect(isFontList("'SFMono-Regular'")).toBe(true);
    expect(isFontList('SFMono-Regular, monospace')).toBe(false);
    expect(isFontList('inherit')).toBe(false);
    expect(isFontList("'Plex' sans-serif")).toBe(false);
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
    pageBase: '/ext/git.example/jack/diplomacy',
    frame: () => frame as unknown as Window,
    runAction: vi.fn(async (): Promise<ActionOutcome> => ({ ok: true, value: { count: 1 } })),
    names: vi.fn(async (): Promise<NamesAnswer> => ({ names: { [KEITH]: { handle: 'keith.is', displayName: 'Keith' } }, dids: {} })),
    theme: vi.fn(() => THEME),
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
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'atmobb:init', v, mode: 'thread', thread: { uri: THREAD }, signedIn: true, path: '', pageBase: '/ext/git.example/jack/diplomacy', theme: THEME }, '*');
  });

  it("sends the frame the forum's theme when it changes after init, and only then", () => {
    let current = THEME;
    const { bridge, frame, posted } = harness({ theme: () => current });
    current = { ...THEME, scheme: 'dark' };
    bridge.theme();
    expect(frame.postMessage).not.toHaveBeenCalled();

    bridge.load();
    expect(posted()[0]).toMatchObject({ type: 'atmobb:init', theme: { ...THEME, scheme: 'dark' } });
    bridge.theme();
    expect(frame.postMessage).toHaveBeenCalledOnce();

    current = { scheme: 'light', colors: { ...THEME.colors, ground: '#12131a' }, fonts: THEME.fonts };
    bridge.theme();
    bridge.theme();
    expect(posted().slice(1)).toEqual([{ type: 'atmobb:theme', v, theme: current }]);
    expect(frame.postMessage.mock.calls[1][1]).toBe('*');
  });

  it('never sends a theme outside the schema, and goes quiet once the panel is torn down', () => {
    let current: PanelTheme = { ...THEME, colors: { ground: '#fff;}' } };
    const { bridge, frame, posted } = harness({ theme: () => current });
    bridge.load();
    expect(posted()[0]).toMatchObject({ theme: { scheme: 'light', colors: {}, fonts: {} } });
    current = THEME;
    bridge.close();
    bridge.theme();
    expect(frame.postMessage).toHaveBeenCalledOnce();
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
    expect(frame.postMessage).toHaveBeenCalledWith({ type: 'atmobb:init', v, mode: 'page', thread: null, signedIn: false, path: 'games/spring-1901', pageBase: '/ext/git.example/jack/diplomacy', theme: THEME }, '*');
  });

  it('hands each valid source on a standalone page to the page, later ones included', () => {
    const source = vi.fn();
    const { bridge, frame } = harness({ mode: 'page', thread: null, source });
    bridge.load();
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:source', v, did: 'did:plc:forumone' } });
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:source', v, did: 'not a did' } });
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:source', v, did: 'did:plc:forumtwo' } });
    expect(source.mock.calls).toEqual([['did:plc:forumone'], ['did:plc:forumtwo']]);
    expect(frame.postMessage).toHaveBeenCalledOnce();
  });

  it('ignores a source message on a thread, or from another window', () => {
    const source = vi.fn();
    const onThread = harness({ source });
    onThread.bridge.message({ source: onThread.frame as unknown as Window, data: { type: 'atmobb:source', v, did: 'did:plc:forumone' } });
    const onPage = harness({ mode: 'page', thread: null, source });
    onPage.bridge.message({ source: { postMessage: vi.fn() } as unknown as Window, data: { type: 'atmobb:source', v, did: 'did:plc:forumone' } });
    expect(source).not.toHaveBeenCalled();
  });

  it('hands a link and its clear to the page, and ignores one on the attach page', () => {
    const link = vi.fn();
    const { bridge, frame } = harness({ link });
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:link', v, page: 'games/spring-1901', label: 'Replay board' } });
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:link', v, page: '', label: '' } });
    expect(link.mock.calls).toEqual([['games/spring-1901', 'Replay board'], ['', '']]);

    const attach = vi.fn();
    const onAttach = harness({ mode: 'attach', link: attach });
    onAttach.bridge.message({ source: onAttach.frame as unknown as Window, data: { type: 'atmobb:link', v, page: 'games/spring-1901', label: 'Replay board' } });
    expect(attach).not.toHaveBeenCalled();
  });

  it('looks names up for its own frame in every mode and answers with the same id', async () => {
    for (const mode of ['thread', 'page', 'attach'] as const) {
      const { bridge, frame, options, posted } = harness({ mode });
      bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:names', v, id: 'n1', dids: [KEITH], handles: ['@keith.is'] } });
      expect(options.names).toHaveBeenCalledExactlyOnceWith([KEITH], ['@keith.is']);
      await flush();
      expect(posted()).toEqual([{ type: 'atmobb:names-result', v, id: 'n1', names: { [KEITH]: { handle: 'keith.is', displayName: 'Keith' } }, dids: {} }]);
    }
  });

  it('answers null for everything asked when the lookup fails', async () => {
    const names = vi.fn(async (): Promise<NamesAnswer> => {
      throw new TypeError('Failed to fetch');
    });
    const { bridge, frame, posted } = harness({ names });
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:names', v, id: 2, dids: [KEITH, JACK], handles: ['keith.is'] } });
    await flush();
    expect(posted()).toEqual([{ type: 'atmobb:names-result', v, id: 2, names: { [KEITH]: null, [JACK]: null }, dids: { 'keith.is': null } }]);
  });

  it('ignores a names message from another window or outside the schema, and drops an answer once the panel is torn down', async () => {
    let finish!: (answer: NamesAnswer) => void;
    const names = vi.fn(() => new Promise<NamesAnswer>((resolve) => (finish = resolve)));
    const { bridge, frame } = harness({ names });
    bridge.message({ source: { postMessage: vi.fn() } as unknown as Window, data: { type: 'atmobb:names', v, id: 1, dids: [KEITH] } });
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:names', v, id: 1, dids: ['keith.is'] } });
    expect(names).not.toHaveBeenCalled();

    bridge.load();
    bridge.message({ source: frame as unknown as Window, data: { type: 'atmobb:names', v, id: 1, dids: [KEITH] } });
    bridge.load();
    frame.postMessage.mockClear();
    finish({ names: { [KEITH]: null }, dids: {} });
    await flush();
    expect(frame.postMessage).not.toHaveBeenCalled();
  });
});
