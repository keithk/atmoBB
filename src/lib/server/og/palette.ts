import { normalizeTheme, themeTokens } from '$lib/themes';

const classic = {
  bg: '#eceae7',
  surface: '#ffffff',
  surface2: '#f4f2ef',
  sunken: '#e5e2de',
  line: '#ddd8d3',
  lineStrong: '#c9c3bc',
  edge: '#c9c3bc',
  bevel: 'rgba(255,255,255,0.85)',

  ink: '#2b2a2e',
  inkSoft: '#6c6a70',
  inkFaint: '#9a97a0',
  body: '#2b2a2e',

  accent: '#f79b7a',
  accentInk: '#4a2a1c',
  accentSoft: '#fdeee7',
  link: '#c05a37',

  catBg: 'linear-gradient(180deg,#f3f0ec,#e9e4de)',
  catEdge: '#f79b7a',

  rank: '#8a5a7a',
  rankBg: '#f3e7ef',

  online: '#4a9b4e',
  idle: '#d0951f',
  offline: '#a7a2ab',
  radius: 8,
  shadow: '0 1px 0 rgba(33,28,22,0.04), 0 1px 2px rgba(33,28,22,0.06)',
};

export type OgSkin = { [K in keyof typeof classic]: (typeof classic)[K] extends number ? number : string };
export const skin: OgSkin = classic;

const TOKEN_TO_SKIN = {
  '--forum-bg': 'bg',
  '--forum-surface': 'surface',
  '--forum-surface-2': 'surface2',
  '--forum-sunken': 'sunken',
  '--forum-line': 'line',
  '--forum-line-strong': 'lineStrong',
  '--forum-edge': 'edge',
  '--forum-bevel': 'bevel',
  '--forum-ink': 'ink',
  '--forum-ink-soft': 'inkSoft',
  '--forum-ink-faint': 'inkFaint',
  '--forum-accent': 'accent',
  '--forum-accent-ink': 'accentInk',
  '--forum-accent-soft': 'accentSoft',
  '--forum-link': 'link',
  '--forum-cat-bg': 'catBg',
  '--forum-cat-edge': 'catEdge',
  '--forum-rank': 'rank',
  '--forum-rank-bg': 'rankBg',
  '--online': 'online',
  '--idle': 'idle',
  '--offline': 'offline',
  '--shadow-sm': 'shadow',
} as const;

/** Read custom properties from owner `:root` rules, matching the public theme cascade. */
function customProperties(css: unknown): Record<string, string> {
  if (typeof css !== 'string') return {};
  const properties: Record<string, string> = {};
  const source = css.slice(0, 100_000).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of source.matchAll(/:root\s*\{([^{}]*)\}/gi)) {
    for (const declaration of match[1].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).trim();
      if (name.startsWith('--') && value) properties[name] = value;
    }
  }
  return properties;
}

function resolveValue(value: string, properties: Record<string, string>): string {
  let resolved = value;
  for (let pass = 0; pass < 10 && resolved.includes('var('); pass++) {
    resolved = resolved.replace(/var\(\s*(--[\w-]+)(?:\s*,\s*([^()]+))?\s*\)/g, (_, name, fallback = '') =>
      properties[name] ?? fallback.trim(),
    );
  }
  return resolved;
}

const safeStyleValue = (value: string): boolean =>
  value.length <= 500 && !/url\s*\(|image\s*\(|expression\s*\(|var\s*\(/i.test(value);

/**
 * The OG renderer cannot execute stylesheets, so it consumes the same stable
 * design-token contract as the browser. Built-in theme values are applied
 * first and owner `:root` overrides win, just as they do on public pages.
 */
export function ogSkin(theme: unknown, customCss?: unknown): OgSkin {
  const properties = {
    '--online': classic.online,
    '--idle': classic.idle,
    '--offline': classic.offline,
    '--radius-lg': `${classic.radius}px`,
    '--shadow-sm': classic.shadow,
    ...themeTokens(normalizeTheme(theme)),
    ...customProperties(customCss),
  };
  const colors: OgSkin = { ...classic };
  for (const [token, key] of Object.entries(TOKEN_TO_SKIN)) {
    const value = resolveValue(properties[token] ?? '', properties);
    if (value && safeStyleValue(value)) (colors[key] as string) = value;
  }
  colors.body = colors.ink;

  const radius = resolveValue(properties['--radius-lg'], properties).trim();
  const match = radius.match(/^([\d.]+)(px|rem)?$/);
  if (match) colors.radius = Math.min(120, Number(match[1]) * (match[2] === 'rem' ? 16 : 1));
  return colors;
}

export const font = {
  display: 'Plex Sans',
  wordmark: 'Plex Sans',
  body: 'Plex Sans',
  mono: 'Plex Mono',
  serif: 'Newsreader',
} as const;

export const OG = { width: 1200, height: 630 } as const;
