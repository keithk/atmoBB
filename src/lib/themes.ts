/**
 * Built-in forum themes. Each preset is a complete set of the `--forum-*`
 * color tokens from `src/lib/styles/tokens/themes.css`, so a theme can never
 * leave a component half-skinned, plus an optional stylesheet in
 * `src/lib/styles/themes/` that restyles layout, type and shape through the
 * stable `.atm-*` hooks. The token map feeds the public style tag, the admin
 * picker swatches, profile skins and the social preview.
 *
 * A light theme carries a second token map for dark mode and follows the
 * visitor's `prefers-color-scheme`; a dark theme looks the same in both.
 *
 * Owner custom CSS loads after the theme in the same style tag, and the
 * theme's stylesheet sits in its own cascade layer, so owner CSS keeps
 * winning without `!important`, exactly as documented in docs/theming.md.
 */
import arcadeCss from './styles/themes/arcade.css?raw';
import atmosphereCss from './styles/themes/atmosphere.css?raw';
import bubblegumCss from './styles/themes/bubblegum.css?raw';
import bulletinCss from './styles/themes/bulletin.css?raw';
import daydreamCss from './styles/themes/daydream.css?raw';
import graphiteCss from './styles/themes/graphite.css?raw';
import midnightCss from './styles/themes/midnight.css?raw';
import terminalCss from './styles/themes/terminal.css?raw';

export const FORUM_THEMES = ['atmosphere', 'coral', 'bulletin', 'bubblegum', 'graphite', 'daydream', 'midnight', 'terminal', 'arcade'] as const;
export type ForumTheme = (typeof FORUM_THEMES)[number];
/** What a forum profile with no saved theme shows. */
export const DEFAULT_THEME: ForumTheme = 'coral';
/** What a newly set-up forum starts with. */
export const NEW_FORUM_THEME: ForumTheme = 'atmosphere';

// Theme names that records written by earlier releases may still carry.
const RENAMED_THEMES: Record<string, ForumTheme> = { classic: 'coral', forest: 'coral', sky: 'atmosphere' };

/** The theme a stored value names, following renames; undefined for anything else. */
export function knownTheme(value: unknown): ForumTheme | undefined {
  if (typeof value !== 'string') return undefined;
  if ((FORUM_THEMES as readonly string[]).includes(value)) return value as ForumTheme;
  return Object.hasOwn(RENAMED_THEMES, value) ? RENAMED_THEMES[value] : undefined;
}

/** Undefined inherits the account default; an empty string explicitly keeps forum styling. */
export function forumThemeOverride(value: unknown, forum: string): ForumTheme | '' | undefined {
  if (!Array.isArray(value)) return undefined;
  const theme = value.find((entry) => entry?.forum === forum)?.theme;
  return theme === '' ? '' : knownTheme(theme);
}

export function personalTheme(profile: { theme?: unknown; forumThemes?: unknown } | null, forum: string): ForumTheme | '' {
  return forumThemeOverride(profile?.forumThemes, forum) ?? knownTheme(profile?.theme) ?? '';
}

export interface ThemePreset {
  value: ForumTheme;
  label: string;
  description: string;
  /** Whether the theme is dark in both modes; a light theme switches to `darkTokens` in dark mode. */
  dark: boolean;
  /** Swatches for the picker: page background, accent, and a third characteristic color. */
  swatches: [string, string, string];
  /** `--forum-*` and utility tokens: the light-mode values of a light theme, or a dark theme's only values. */
  tokens: Record<string, string>;
  /** Dark-mode values of a light theme, one for every entry in `tokens`. */
  darkTokens?: Record<string, string>;
}

// Status hues and shadows are shared chrome on :root (tokens/colors.css and
// tokens/spacing.css), but their light tints glare on dark surfaces, so every
// preset states them for the modes it has.
const LIGHT_UTILITIES: Record<string, string> = {
  '--ok-1': '#2f7d55',
  '--ok-bg': '#e0efe4',
  '--warn-1': '#b06f13',
  '--warn-bg': '#f6ecd6',
  '--danger-1': '#b23b2c',
  '--danger-bg': '#f6ded9',
  '--info-1': '#2f6fb0',
  '--info-bg': '#e2edf7',
  '--shadow-sm': '0 1px 2px rgba(33, 28, 22, 0.05)',
  '--shadow-md': '0 1px 2px rgba(33, 28, 22, 0.06), 0 4px 10px rgba(33, 28, 22, 0.08)',
  '--shadow-lg': '0 6px 24px rgba(33, 28, 22, 0.14)',
};
const DARK_UTILITIES: Record<string, string> = {
  '--ok-1': '#6cc48f',
  '--ok-bg': '#16301f',
  '--warn-1': '#e0b04a',
  '--warn-bg': '#332a14',
  '--danger-1': '#ef7d70',
  '--danger-bg': '#3a1c19',
  '--info-1': '#7fb0e8',
  '--info-bg': '#172637',
  '--shadow-sm': '0 1px 0 rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.4)',
  '--shadow-md': '0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.45)',
  '--shadow-lg': '0 6px 24px rgba(0, 0, 0, 0.6)',
};

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    value: 'atmosphere',
    label: 'Atmosphere',
    description: 'A tinted sidebar with pill navigation and a white sheet of flat, borderless rows.',
    dark: false,
    swatches: ['#f1f3f6', '#0a66d8', '#1b2430'],
    tokens: {
      '--forum-bg': '#f1f3f6',
      '--forum-surface': '#ffffff',
      '--forum-surface-2': '#f5f7fa',
      '--forum-sunken': '#e9edf2',
      '--forum-line': '#e3e7ec',
      '--forum-line-strong': '#cdd4dd',
      '--forum-edge': '#dfe4ea',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#1b2430',
      '--forum-ink-soft': '#5f6b7a',
      '--forum-ink-faint': '#8a95a3',
      '--forum-accent': '#0a66d8',
      '--forum-accent-hover': '#0957b9',
      '--forum-accent-ink': '#ffffff',
      '--forum-accent-soft': '#dbe6f4',
      '--forum-link': '#0a56b8',
      '--forum-link-hover': '#083f88',
      '--forum-cat-bg': '#ffffff',
      '--forum-cat-ink': '#1b2430',
      '--forum-cat-edge': '#e3e7ec',
      '--forum-header-bg': '#f1f3f6',
      '--forum-header-ink': '#1b2430',
      '--forum-pin-bg': '#f3f7fc',
      '--forum-pin-edge': '#0a66d8',
      '--forum-lock-bg': '#f1f3f6',
      '--forum-lock-edge': '#97a1b0',
      '--forum-rank': '#4a63b8',
      '--forum-rank-bg': '#e6ebf8',
      ...LIGHT_UTILITIES,
    },
    darkTokens: {
      '--forum-bg': '#131920',
      '--forum-surface': '#1a212b',
      '--forum-surface-2': '#202936',
      '--forum-sunken': '#0f141a',
      '--forum-line': '#29323e',
      '--forum-line-strong': '#3a4554',
      '--forum-edge': '#29323e',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#e8edf3',
      '--forum-ink-soft': '#97a3b3',
      '--forum-ink-faint': '#6d7989',
      '--forum-accent': '#4c9aff',
      '--forum-accent-hover': '#6fb0ff',
      '--forum-accent-ink': '#06203f',
      '--forum-accent-soft': '#21334c',
      '--forum-link': '#8fc0ff',
      '--forum-link-hover': '#b4d5ff',
      '--forum-cat-bg': '#1a212b',
      '--forum-cat-ink': '#e8edf3',
      '--forum-cat-edge': '#29323e',
      '--forum-header-bg': '#131920',
      '--forum-header-ink': '#e8edf3',
      '--forum-pin-bg': '#1d2a3b',
      '--forum-pin-edge': '#4c9aff',
      '--forum-lock-bg': '#171d25',
      '--forum-lock-edge': '#5d6877',
      '--forum-rank': '#a9b8f5',
      '--forum-rank-bg': '#232c52',
      ...DARK_UTILITIES,
    },
  },
  {
    value: 'coral',
    label: 'Coral',
    description: 'A white card on greige with coral buttons and a tinted page header.',
    dark: false,
    swatches: ['#eceae7', '#f79b7a', '#2b2a2e'],
    tokens: {
      '--forum-bg': '#eceae7',
      '--forum-surface': '#ffffff',
      '--forum-surface-2': '#f4f2ef',
      '--forum-sunken': '#e5e2de',
      '--forum-line': '#ddd8d3',
      '--forum-line-strong': '#c9c3bc',
      '--forum-edge': '#c9c3bc',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#2b2a2e',
      '--forum-ink-soft': '#6c6a70',
      '--forum-ink-faint': '#9a97a0',
      '--forum-accent': '#f79b7a',
      '--forum-accent-hover': '#f2895f',
      '--forum-accent-ink': '#4a2a1c',
      '--forum-accent-soft': '#fdeee7',
      '--forum-link': '#c05a37',
      '--forum-link-hover': '#9d4529',
      '--forum-cat-bg': '#f1eeea',
      '--forum-cat-ink': '#2b2a2e',
      '--forum-cat-edge': '#f79b7a',
      '--forum-header-bg': '#ffffff',
      '--forum-header-ink': '#2b2a2e',
      '--forum-pin-bg': '#fbf1d8',
      '--forum-pin-edge': '#d9b24b',
      '--forum-lock-bg': '#eef0f3',
      '--forum-lock-edge': '#97a1b0',
      '--forum-rank': '#8a5a7a',
      '--forum-rank-bg': '#f3e7ef',
      ...LIGHT_UTILITIES,
    },
    darkTokens: {
      '--forum-bg': '#1c1a19',
      '--forum-surface': '#262322',
      '--forum-surface-2': '#2e2a28',
      '--forum-sunken': '#161413',
      '--forum-line': '#3a3533',
      '--forum-line-strong': '#4d4643',
      '--forum-edge': '#4d4643',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#f1ece8',
      '--forum-ink-soft': '#b0a8a3',
      '--forum-ink-faint': '#7d7570',
      '--forum-accent': '#f79b7a',
      '--forum-accent-hover': '#ffb195',
      '--forum-accent-ink': '#3a1d10',
      '--forum-accent-soft': '#40291f',
      '--forum-link': '#ffb195',
      '--forum-link-hover': '#ffcbb8',
      '--forum-cat-bg': '#2b2725',
      '--forum-cat-ink': '#f1ece8',
      '--forum-cat-edge': '#f79b7a',
      '--forum-header-bg': '#262322',
      '--forum-header-ink': '#f1ece8',
      '--forum-pin-bg': '#352c18',
      '--forum-pin-edge': '#b08f3a',
      '--forum-lock-bg': '#24272c',
      '--forum-lock-edge': '#5d6877',
      '--forum-rank': '#d9a6c8',
      '--forum-rank-bg': '#3a2a35',
      ...DARK_UTILITIES,
    },
  },
  {
    value: 'bulletin',
    label: 'Bulletin',
    description: 'A 2004 message board: small Verdana, boxed tables, gradient header bars.',
    dark: false,
    swatches: ['#dfe6ef', '#2f5f9e', '#1a2a40'],
    tokens: {
      '--forum-bg': '#dfe6ef',
      '--forum-surface': '#f7f9fc',
      '--forum-surface-2': '#eaf0f7',
      '--forum-sunken': '#d3dce8',
      '--forum-line': '#9fb0c6',
      '--forum-line-strong': '#7f93ad',
      '--forum-edge': '#7f93ad',
      '--forum-bevel': '#ffffff',
      '--forum-ink': '#1a2a40',
      '--forum-ink-soft': '#56667c',
      '--forum-ink-faint': '#7f8da1',
      '--forum-accent': '#2f5f9e',
      '--forum-accent-hover': '#264f85',
      '--forum-accent-ink': '#ffffff',
      '--forum-accent-soft': '#dfe9f6',
      '--forum-link': '#1f4f96',
      '--forum-link-hover': '#b3401a',
      '--forum-cat-bg': '#2f5f9e',
      '--forum-cat-ink': '#ffffff',
      '--forum-cat-edge': '#1f4a80',
      '--forum-header-bg': '#f7f9fc',
      '--forum-header-ink': '#1a2a40',
      '--forum-pin-bg': '#fff8dc',
      '--forum-pin-edge': '#d4a72c',
      '--forum-lock-bg': '#e6e8ec',
      '--forum-lock-edge': '#8a93a0',
      '--forum-rank': '#5a4a9e',
      '--forum-rank-bg': '#e9e6f7',
      ...LIGHT_UTILITIES,
    },
    darkTokens: {
      '--forum-bg': '#18202c',
      '--forum-surface': '#222c3b',
      '--forum-surface-2': '#273344',
      '--forum-sunken': '#131a24',
      '--forum-line': '#3d4c63',
      '--forum-line-strong': '#52647f',
      '--forum-edge': '#52647f',
      '--forum-bevel': 'rgba(255, 255, 255, 0.06)',
      '--forum-ink': '#dfe7f2',
      '--forum-ink-soft': '#94a4ba',
      '--forum-ink-faint': '#6f7f96',
      '--forum-accent': '#3d6cae',
      '--forum-accent-hover': '#4a7cc2',
      '--forum-accent-ink': '#ffffff',
      '--forum-accent-soft': '#2d3a4e',
      '--forum-link': '#8db6ee',
      '--forum-link-hover': '#ffb27a',
      '--forum-cat-bg': '#264a7e',
      '--forum-cat-ink': '#ffffff',
      '--forum-cat-edge': '#1b3660',
      '--forum-header-bg': '#222c3b',
      '--forum-header-ink': '#dfe7f2',
      '--forum-pin-bg': '#3a3420',
      '--forum-pin-edge': '#a8862a',
      '--forum-lock-bg': '#1d232d',
      '--forum-lock-edge': '#5d6877',
      '--forum-rank': '#b3a8f0',
      '--forum-rank-bg': '#2c2852',
      ...DARK_UTILITIES,
    },
  },
  {
    value: 'bubblegum',
    label: 'Bubblegum',
    description: 'Sticker-sheet cards with thick outlines and hard shadows in pink and aqua.',
    dark: false,
    swatches: ['#ffe3f0', '#ff5fa8', '#7ee8dc'],
    tokens: {
      '--forum-bg': '#ffe3f0',
      '--forum-surface': '#ffffff',
      '--forum-surface-2': '#fff3f8',
      '--forum-sunken': '#ffd1e6',
      '--forum-line': '#f0bcd6',
      '--forum-line-strong': '#2b1b2e',
      '--forum-edge': '#2b1b2e',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#2b1b2e',
      '--forum-ink-soft': '#6d4f66',
      '--forum-ink-faint': '#9a7c92',
      '--forum-accent': '#ff5fa8',
      '--forum-accent-hover': '#ff7dbb',
      '--forum-accent-ink': '#2b1b2e',
      '--forum-accent-soft': '#ffd6e8',
      '--forum-link': '#0b7f79',
      '--forum-link-hover': '#075a55',
      '--forum-cat-bg': '#7ee8dc',
      '--forum-cat-ink': '#2b1b2e',
      '--forum-cat-edge': '#2b1b2e',
      '--forum-header-bg': '#ffe3f0',
      '--forum-header-ink': '#2b1b2e',
      '--forum-pin-bg': '#fff3a8',
      '--forum-pin-edge': '#2b1b2e',
      '--forum-lock-bg': '#ece6ee',
      '--forum-lock-edge': '#2b1b2e',
      '--forum-rank': '#0b7f79',
      '--forum-rank-bg': '#d5f7f3',
      ...LIGHT_UTILITIES,
    },
    darkTokens: {
      '--forum-bg': '#24131f',
      '--forum-surface': '#34202d',
      '--forum-surface-2': '#3d2635',
      '--forum-sunken': '#1a0d16',
      '--forum-line': '#5a3a4c',
      '--forum-line-strong': '#ff8cc4',
      '--forum-edge': '#ff8cc4',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#ffeaf4',
      '--forum-ink-soft': '#cfa3bb',
      '--forum-ink-faint': '#9a7388',
      '--forum-accent': '#ff5fa8',
      '--forum-accent-hover': '#ff7dbb',
      '--forum-accent-ink': '#2b0a1b',
      '--forum-accent-soft': '#4a1f36',
      '--forum-link': '#5fe0d3',
      '--forum-link-hover': '#9af0e7',
      '--forum-cat-bg': '#1f8f86',
      '--forum-cat-ink': '#eafffb',
      '--forum-cat-edge': '#ff8cc4',
      '--forum-header-bg': '#24131f',
      '--forum-header-ink': '#ffeaf4',
      '--forum-pin-bg': '#4a3d12',
      '--forum-pin-edge': '#ffd23f',
      '--forum-lock-bg': '#2c2430',
      '--forum-lock-edge': '#8a7890',
      '--forum-rank': '#5fe0d3',
      '--forum-rank-bg': '#143330',
      ...DARK_UTILITIES,
    },
  },
  {
    value: 'graphite',
    label: 'Graphite',
    description: 'Dense and quiet like an issue tracker, with near-black buttons and indigo links.',
    dark: false,
    swatches: ['#f6f7f9', '#1f2328', '#4f46e5'],
    tokens: {
      '--forum-bg': '#f6f7f9',
      '--forum-surface': '#ffffff',
      '--forum-surface-2': '#f6f7f9',
      '--forum-sunken': '#eceef2',
      '--forum-line': '#d5d9df',
      '--forum-line-strong': '#c1c7d0',
      '--forum-edge': '#d5d9df',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#1c2128',
      '--forum-ink-soft': '#5c6570',
      '--forum-ink-faint': '#8b939e',
      '--forum-accent': '#1f2328',
      '--forum-accent-hover': '#32383f',
      '--forum-accent-ink': '#ffffff',
      '--forum-accent-soft': '#e6e9ee',
      '--forum-link': '#4f46e5',
      '--forum-link-hover': '#3730a3',
      '--forum-cat-bg': '#f6f7f9',
      '--forum-cat-ink': '#1c2128',
      '--forum-cat-edge': '#d5d9df',
      '--forum-header-bg': '#f6f7f9',
      '--forum-header-ink': '#1c2128',
      '--forum-pin-bg': '#fff8dc',
      '--forum-pin-edge': '#d4a72c',
      '--forum-lock-bg': '#f0f1f3',
      '--forum-lock-edge': '#8b939e',
      '--forum-rank': '#4f46e5',
      '--forum-rank-bg': '#e8e7fd',
      ...LIGHT_UTILITIES,
    },
    darkTokens: {
      '--forum-bg': '#0f1216',
      '--forum-surface': '#161a20',
      '--forum-surface-2': '#1c2128',
      '--forum-sunken': '#0a0c0f',
      '--forum-line': '#2b313a',
      '--forum-line-strong': '#3b424d',
      '--forum-edge': '#2b313a',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#e6e9ee',
      '--forum-ink-soft': '#949dab',
      '--forum-ink-faint': '#6b7480',
      '--forum-accent': '#e6e9ee',
      '--forum-accent-hover': '#ffffff',
      '--forum-accent-ink': '#0f1216',
      '--forum-accent-soft': '#1f252d',
      '--forum-link': '#9d97ff',
      '--forum-link-hover': '#c1bdff',
      '--forum-cat-bg': '#161a20',
      '--forum-cat-ink': '#e6e9ee',
      '--forum-cat-edge': '#2b313a',
      '--forum-header-bg': '#0f1216',
      '--forum-header-ink': '#e6e9ee',
      '--forum-pin-bg': '#2c2714',
      '--forum-pin-edge': '#a8862a',
      '--forum-lock-bg': '#14171c',
      '--forum-lock-edge': '#5d6570',
      '--forum-rank': '#b3aeff',
      '--forum-rank-bg': '#262452',
      ...DARK_UTILITIES,
    },
  },
  {
    value: 'daydream',
    label: 'Daydream',
    description: 'A soft gradient sky behind frosted, rounded panels.',
    dark: false,
    swatches: ['#f3e9fb', '#7a59e6', '#ec6fb0'],
    tokens: {
      '--forum-bg': '#f3e9fb',
      '--forum-surface': '#ffffff',
      '--forum-surface-2': '#f8f2fd',
      '--forum-sunken': '#eadcf6',
      '--forum-line': '#e6dbf2',
      '--forum-line-strong': '#d2c2e6',
      '--forum-edge': '#e6dbf2',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#2a2440',
      '--forum-ink-soft': '#6b6388',
      '--forum-ink-faint': '#9890b3',
      '--forum-accent': '#7a59e6',
      '--forum-accent-hover': '#6847d6',
      '--forum-accent-ink': '#ffffff',
      '--forum-accent-soft': '#ece4fd',
      '--forum-link': '#6344d1',
      '--forum-link-hover': '#4a2fb0',
      '--forum-cat-bg': '#ffffff',
      '--forum-cat-ink': '#2a2440',
      '--forum-cat-edge': '#e6dbf2',
      '--forum-header-bg': '#f3e9fb',
      '--forum-header-ink': '#2a2440',
      '--forum-pin-bg': '#fff0f7',
      '--forum-pin-edge': '#ec6fb0',
      '--forum-lock-bg': '#f1eef5',
      '--forum-lock-edge': '#a59dba',
      '--forum-rank': '#c0398a',
      '--forum-rank-bg': '#fde4f1',
      ...LIGHT_UTILITIES,
    },
    darkTokens: {
      '--forum-bg': '#1a1532',
      '--forum-surface': '#251e42',
      '--forum-surface-2': '#2c244d',
      '--forum-sunken': '#130f26',
      '--forum-line': '#382f5c',
      '--forum-line-strong': '#4b4078',
      '--forum-edge': '#382f5c',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#f0ebff',
      '--forum-ink-soft': '#b3a9d6',
      '--forum-ink-faint': '#7f76a6',
      '--forum-accent': '#a78bfa',
      '--forum-accent-hover': '#bda8ff',
      '--forum-accent-ink': '#1c1140',
      '--forum-accent-soft': '#33295c',
      '--forum-link': '#c4b3ff',
      '--forum-link-hover': '#ddd2ff',
      '--forum-cat-bg': '#251e42',
      '--forum-cat-ink': '#f0ebff',
      '--forum-cat-edge': '#382f5c',
      '--forum-header-bg': '#1a1532',
      '--forum-header-ink': '#f0ebff',
      '--forum-pin-bg': '#3a1f3d',
      '--forum-pin-edge': '#ec6fb0',
      '--forum-lock-bg': '#1f1a33',
      '--forum-lock-edge': '#6b6388',
      '--forum-rank': '#ff9fd0',
      '--forum-rank-bg': '#45203a',
      ...DARK_UTILITIES,
    },
  },
  {
    value: 'midnight',
    label: 'Midnight',
    description: 'Navy panels with amber accents, matched to the Midnight social preview.',
    dark: true,
    swatches: ['#12131a', '#ffb454', '#ecebf3'],
    tokens: {
      '--forum-bg': '#12131a',
      '--forum-surface': '#1b1c26',
      '--forum-surface-2': '#202230',
      '--forum-sunken': '#0e0f15',
      '--forum-line': '#2b2d3b',
      '--forum-line-strong': '#3a3d4f',
      '--forum-edge': '#3a3d4f',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#ecebf3',
      '--forum-ink-soft': '#a7a6b8',
      '--forum-ink-faint': '#737388',
      '--forum-accent': '#ffb454',
      '--forum-accent-hover': '#ffc470',
      '--forum-accent-ink': '#2a1a05',
      '--forum-accent-soft': '#3a2c16',
      '--forum-link': '#ffc470',
      '--forum-link-hover': '#ffd694',
      '--forum-cat-bg': '#20222f',
      '--forum-cat-ink': '#ecebf3',
      '--forum-cat-edge': '#ffb454',
      '--forum-header-bg': '#1b1c26',
      '--forum-header-ink': '#f5f1ff',
      '--forum-pin-bg': '#2c2618',
      '--forum-pin-edge': '#b58a3a',
      '--forum-lock-bg': '#181a22',
      '--forum-lock-edge': '#5a5d72',
      '--forum-rank': '#c9a1e6',
      '--forum-rank-bg': '#2b2238',
      ...DARK_UTILITIES,
    },
  },
  {
    value: 'terminal',
    label: 'Terminal',
    description: 'Monospace on near-black with phosphor green and dashed rules.',
    dark: true,
    swatches: ['#0a0d0a', '#3ddc84', '#cfe6cb'],
    tokens: {
      '--forum-bg': '#0a0d0a',
      '--forum-surface': '#0a0d0a',
      '--forum-surface-2': '#111611',
      '--forum-sunken': '#060806',
      '--forum-line': '#263226',
      '--forum-line-strong': '#3a4d3a',
      '--forum-edge': '#3a4d3a',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#cfe6cb',
      '--forum-ink-soft': '#8aa585',
      '--forum-ink-faint': '#5f7a5b',
      '--forum-accent': '#3ddc84',
      '--forum-accent-hover': '#6ff0a3',
      '--forum-accent-ink': '#04210f',
      '--forum-accent-soft': '#12301e',
      '--forum-link': '#3ddc84',
      '--forum-link-hover': '#9bf5c0',
      '--forum-cat-bg': '#0a0d0a',
      '--forum-cat-ink': '#3ddc84',
      '--forum-cat-edge': '#263226',
      '--forum-header-bg': '#0a0d0a',
      '--forum-header-ink': '#cfe6cb',
      '--forum-pin-bg': '#1a1a0c',
      '--forum-pin-edge': '#c9c13a',
      '--forum-lock-bg': '#101210',
      '--forum-lock-edge': '#5f7a5b',
      '--forum-rank': '#e6c15a',
      '--forum-rank-bg': '#2e2810',
      ...DARK_UTILITIES,
    },
  },
  {
    value: 'arcade',
    label: 'Arcade',
    description: 'Pixel headings, square corners and neon cyan and magenta on indigo.',
    dark: true,
    swatches: ['#110d24', '#ff4fd8', '#22d3ee'],
    tokens: {
      '--forum-bg': '#110d24',
      '--forum-surface': '#1c1638',
      '--forum-surface-2': '#241d45',
      '--forum-sunken': '#0b0818',
      '--forum-line': '#3a2f6b',
      '--forum-line-strong': '#5244a0',
      '--forum-edge': '#3a2f6b',
      '--forum-bevel': 'transparent',
      '--forum-ink': '#efeaff',
      '--forum-ink-soft': '#a59cd6',
      '--forum-ink-faint': '#7268a8',
      '--forum-accent': '#ff4fd8',
      '--forum-accent-hover': '#ff7ce2',
      '--forum-accent-ink': '#2a0624',
      '--forum-accent-soft': '#123448',
      '--forum-link': '#67e3f9',
      '--forum-link-hover': '#a5f0ff',
      '--forum-cat-bg': '#1c1638',
      '--forum-cat-ink': '#22d3ee',
      '--forum-cat-edge': '#ff4fd8',
      '--forum-header-bg': '#110d24',
      '--forum-header-ink': '#efeaff',
      '--forum-pin-bg': '#2a2410',
      '--forum-pin-edge': '#ffd23f',
      '--forum-lock-bg': '#15112a',
      '--forum-lock-edge': '#5244a0',
      '--forum-rank': '#ff7ce2',
      '--forum-rank-bg': '#401a48',
      ...DARK_UTILITIES,
    },
  },
];

// Layout, type and shape rules per theme. Coral is the built-in look, so it has none.
const THEME_STYLESHEETS: Partial<Record<ForumTheme, string>> = {
  atmosphere: atmosphereCss,
  bulletin: bulletinCss,
  bubblegum: bubblegumCss,
  graphite: graphiteCss,
  daydream: daydreamCss,
  midnight: midnightCss,
  terminal: terminalCss,
  arcade: arcadeCss,
};

export function themePreset(theme: ForumTheme): ThemePreset {
  return THEME_PRESETS.find((preset) => preset.value === theme) ?? THEME_PRESETS[0];
}

/** Normalize an indexed record value at the read boundary; unknown values fall back to the default. */
export function normalizeTheme(value: unknown): ForumTheme {
  return knownTheme(value) ?? DEFAULT_THEME;
}

/** The theme's token values in light mode, or its only values when the theme is always dark. */
export function themeTokens(theme: ForumTheme): Record<string, string> {
  return themePreset(theme).tokens;
}

// `light-dark()` only takes colors, so a shadow cannot be written as one value for both modes.
const isColorToken = (name: string) => !name.startsWith('--shadow-');

/** Declarations that hold in both modes: colors as `light-dark()` pairs, everything else at its light value. */
function declarations(preset: ThemePreset): string[] {
  const list = Object.entries(preset.tokens).map(([name, value]) => {
    const dark = preset.darkTokens?.[name];
    return dark && dark !== value && isColorToken(name) ? `${name}:light-dark(${value}, ${dark})` : `${name}:${value}`;
  });
  return list.concat(`color-scheme:${preset.dark ? 'dark' : 'light dark'}`);
}

/**
 * Inline `style` string that re-skins a subtree in a theme's colors, used by
 * the stamp preview and member profile skins. The subtree can sit inside a
 * page showing a different theme, so it also re-derives `--focus-ring`, which
 * :root resolves against the page accent rather than the skin's.
 */
export function themeInlineStyle(theme: ForumTheme): string {
  return declarations(themePreset(theme))
    .concat('--focus-ring:0 0 0 3px color-mix(in oklch, var(--forum-accent) 40%, transparent)')
    .join(';');
}

/** Inline `style` for a member's profile skin. */
export const profileSkinStyle = themeInlineStyle;

/** Stylesheet text for a theme: its tokens on :root, then its layout rules in the `atmobb-theme` layer. */
export function themeCss(theme: ForumTheme): string {
  const preset = themePreset(theme);
  const darkOnly = Object.entries(preset.darkTokens ?? {})
    .filter(([name]) => !isColorToken(name))
    .map(([name, value]) => `${name}:${value};`);
  const stylesheet = THEME_STYLESHEETS[theme];
  return [
    `:root{${declarations(preset).join(';')};}`,
    darkOnly.length ? `@media (prefers-color-scheme: dark){:root{${darkOnly.join('')}}}` : '',
    stylesheet ? `@layer atmobb-theme{${stylesheet}}` : '',
  ].filter(Boolean).join('\n');
}

/** Browser chrome colors (`<meta name="theme-color">`): the page background in light mode and in dark mode. */
export function themeColors(theme: ForumTheme): { light: string; dark: string } {
  const preset = themePreset(theme);
  const light = preset.tokens['--forum-bg'];
  return { light, dark: preset.darkTokens?.['--forum-bg'] ?? light };
}
