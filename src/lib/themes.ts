/**
 * Built-in forum color themes. Each preset is a complete set of the
 * `--forum-*` tokens from `src/lib/styles/tokens/themes.css`, so a theme can
 * never leave a component half-skinned. The same map feeds the public style
 * tag, the admin picker swatches, and the admin live preview.
 *
 * Owner custom CSS loads after the preset in the same unlayered style tag, so
 * it keeps winning without `!important`, exactly as documented in
 * docs/theming.md.
 */

export const FORUM_THEMES = ['classic', 'sky', 'bubblegum', 'midnight', 'forest'] as const;
export type ForumTheme = (typeof FORUM_THEMES)[number];
export const DEFAULT_THEME: ForumTheme = 'classic';

/** Undefined inherits the account default; an empty string explicitly keeps forum styling. */
export function forumThemeOverride(value: unknown, forum: string): ForumTheme | '' | undefined {
  if (!Array.isArray(value)) return undefined;
  const theme = value.find((entry) => entry?.forum === forum)?.theme;
  return theme === '' || FORUM_THEMES.includes(theme) ? theme : undefined;
}

export function personalTheme(profile: { theme?: unknown; forumThemes?: unknown } | null, forum: string): ForumTheme | '' {
  const theme = forumThemeOverride(profile?.forumThemes, forum) ?? profile?.theme;
  return FORUM_THEMES.includes(theme as ForumTheme) ? theme as ForumTheme : '';
}

export interface ThemePreset {
  value: ForumTheme;
  label: string;
  description: string;
  /** Whether surfaces are dark; drives `color-scheme` for native form controls. */
  dark: boolean;
  /** Swatches for the picker: page background, accent, ink. */
  swatches: [string, string, string];
  /** `--forum-*` (and, for dark skins, utility hue) tokens. Empty for the built-in default. */
  tokens: Record<string, string>;
}

// Kept in sync with the :root defaults in tokens/colors.css and tokens/themes.css.
const CLASSIC_TOKENS: Record<string, string> = {
  '--forum-bg': '#eceae7',
  '--forum-surface': '#ffffff',
  '--forum-surface-2': '#f4f2ef',
  '--forum-sunken': '#e5e2de',
  '--forum-line': '#ddd8d3',
  '--forum-line-strong': '#c9c3bc',
  '--forum-edge': '#c9c3bc',
  '--forum-bevel': 'rgba(255, 255, 255, 0.85)',
  '--forum-ink': '#2b2a2e',
  '--forum-ink-soft': '#6c6a70',
  '--forum-ink-faint': '#9a97a0',
  '--forum-accent': '#f79b7a',
  '--forum-accent-hover': '#f2895f',
  '--forum-accent-ink': '#4a2a1c',
  '--forum-accent-soft': '#fdeee7',
  '--forum-link': '#c05a37',
  '--forum-link-hover': '#9d4529',
  '--forum-cat-bg': 'linear-gradient(180deg, #f3f0ec, #e9e4de)',
  '--forum-cat-ink': '#2b2a2e',
  '--forum-cat-edge': '#f79b7a',
  '--forum-header-bg': '#ffffff',
  '--forum-header-ink': '#2b2a2e',
  '--forum-pin-bg': '#fbf1d8',
  '--forum-pin-edge': '#d9b24b',
  '--forum-rank': '#8a5a7a',
  '--forum-rank-bg': '#f3e7ef',
};

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    value: 'classic',
    label: 'Classic',
    description: 'The atmobb house skin: cool greige, white panels, coral accents.',
    dark: false,
    swatches: ['#eceae7', '#f79b7a', '#2b2a2e'],
    tokens: {},
  },
  {
    value: 'sky',
    label: 'Sky',
    description: 'Clean white panels on a pale blue page with royal-blue links.',
    dark: false,
    swatches: ['#f3f6fa', '#3b82f6', '#1d2733'],
    tokens: {
      '--forum-bg': '#f3f6fa',
      '--forum-surface': '#ffffff',
      '--forum-surface-2': '#f5f8fc',
      '--forum-sunken': '#e8eef6',
      '--forum-line': '#d9e1ec',
      '--forum-line-strong': '#bfcbdb',
      '--forum-edge': '#bfcbdb',
      '--forum-bevel': 'rgba(255, 255, 255, 0.9)',
      '--forum-ink': '#1d2733',
      '--forum-ink-soft': '#566274',
      '--forum-ink-faint': '#8a96a8',
      '--forum-accent': '#3b82f6',
      '--forum-accent-hover': '#2f6fe0',
      '--forum-accent-ink': '#ffffff',
      '--forum-accent-soft': '#e4eefc',
      '--forum-link': '#1d5fc4',
      '--forum-link-hover': '#164a9a',
      '--forum-cat-bg': 'linear-gradient(180deg, #f7faff, #e9f0fa)',
      '--forum-cat-ink': '#1d2733',
      '--forum-cat-edge': '#3b82f6',
      '--forum-header-bg': '#ffffff',
      '--forum-header-ink': '#1d2733',
      '--forum-pin-bg': '#fff6d6',
      '--forum-pin-edge': '#e0b64a',
      '--forum-rank': '#4a63b8',
      '--forum-rank-bg': '#e6ebf8',
    },
  },
  {
    value: 'bubblegum',
    label: 'Bubblegum',
    description: 'Blush pink surfaces, hot-pink buttons, teal links and pins.',
    dark: false,
    swatches: ['#fdf0f5', '#f472b6', '#14b8a6'],
    tokens: {
      '--forum-bg': '#fdf0f5',
      '--forum-surface': '#ffffff',
      '--forum-surface-2': '#fef5f8',
      '--forum-sunken': '#f8e3ec',
      '--forum-line': '#f0d3df',
      '--forum-line-strong': '#dfb4c6',
      '--forum-edge': '#dfb4c6',
      '--forum-bevel': 'rgba(255, 255, 255, 0.9)',
      '--forum-ink': '#3a2430',
      '--forum-ink-soft': '#7a5a68',
      '--forum-ink-faint': '#a98a97',
      '--forum-accent': '#f472b6',
      '--forum-accent-hover': '#ec5ea8',
      '--forum-accent-ink': '#4a1631',
      '--forum-accent-soft': '#fde2ef',
      '--forum-link': '#0f8f8a',
      '--forum-link-hover': '#0a6f6b',
      '--forum-cat-bg': 'linear-gradient(180deg, #fff0f7, #fbdfeb)',
      '--forum-cat-ink': '#3a2430',
      '--forum-cat-edge': '#14b8a6',
      '--forum-header-bg': '#ffffff',
      '--forum-header-ink': '#3a2430',
      '--forum-pin-bg': '#e0f7f4',
      '--forum-pin-edge': '#14b8a6',
      '--forum-rank': '#0f8f8a',
      '--forum-rank-bg': '#dcf4f1',
    },
  },
  {
    value: 'midnight',
    label: 'Midnight',
    description: 'Dark navy chrome with amber accents, matched to the Midnight social preview.',
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
      '--forum-bevel': 'rgba(255, 255, 255, 0.06)',
      '--forum-ink': '#ecebf3',
      '--forum-ink-soft': '#a7a6b8',
      '--forum-ink-faint': '#737388',
      '--forum-accent': '#ffb454',
      '--forum-accent-hover': '#ffc470',
      '--forum-accent-ink': '#2a1a05',
      '--forum-accent-soft': '#3a2c16',
      '--forum-link': '#ffc470',
      '--forum-link-hover': '#ffd694',
      '--forum-cat-bg': 'linear-gradient(180deg, #252736, #1c1d29)',
      '--forum-cat-ink': '#ecebf3',
      '--forum-cat-edge': '#ffb454',
      '--forum-header-bg': '#1b1c26',
      '--forum-header-ink': '#f5f1ff',
      '--forum-pin-bg': '#2c2618',
      '--forum-pin-edge': '#b58a3a',
      '--forum-rank': '#c9a1e6',
      '--forum-rank-bg': '#2b2238',
      // Utility hues are "shared, not themed" in colors.css, but their light
      // tints glare on dark surfaces, so a dark skin re-tunes them.
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
    },
  },
  {
    value: 'forest',
    label: 'Forest',
    description: 'Cream panels on a sage page with moss-green accents and bark-brown stamps.',
    dark: false,
    swatches: ['#eef0e6', '#79a85a', '#232b22'],
    tokens: {
      '--forum-bg': '#eef0e6',
      '--forum-surface': '#fbfbf6',
      '--forum-surface-2': '#f2f4ea',
      '--forum-sunken': '#e2e6d6',
      '--forum-line': '#d6dbc8',
      '--forum-line-strong': '#b9c1a6',
      '--forum-edge': '#b9c1a6',
      '--forum-bevel': 'rgba(255, 255, 255, 0.85)',
      '--forum-ink': '#232b22',
      '--forum-ink-soft': '#5b665a',
      '--forum-ink-faint': '#8c968a',
      '--forum-accent': '#79a85a',
      '--forum-accent-hover': '#6a9a4c',
      '--forum-accent-ink': '#15260f',
      '--forum-accent-soft': '#e4eedb',
      '--forum-link': '#3f6b2c',
      '--forum-link-hover': '#2f5220',
      '--forum-cat-bg': 'linear-gradient(180deg, #f2f4e8, #e3e8d6)',
      '--forum-cat-ink': '#232b22',
      '--forum-cat-edge': '#79a85a',
      '--forum-header-bg': '#fbfbf6',
      '--forum-header-ink': '#243326',
      '--forum-pin-bg': '#f6efd2',
      '--forum-pin-edge': '#c4a445',
      '--forum-rank': '#8a6a3a',
      '--forum-rank-bg': '#f1e9d8',
    },
  },
];

export function themePreset(theme: ForumTheme): ThemePreset {
  return THEME_PRESETS.find((preset) => preset.value === theme) ?? THEME_PRESETS[0];
}

/** Normalize an indexed record value at the read boundary; unknown values fall back to classic. */
export function normalizeTheme(value: unknown): ForumTheme {
  return typeof value === 'string' && (FORUM_THEMES as readonly string[]).includes(value)
    ? (value as ForumTheme)
    : DEFAULT_THEME;
}

/** The theme's `--forum-*` values, falling back to the classic defaults for the built-in skin. */
export function themeTokens(theme: ForumTheme): Record<string, string> {
  const preset = themePreset(theme);
  return Object.keys(preset.tokens).length ? preset.tokens : CLASSIC_TOKENS;
}

/** Inline `style` string that re-skins a subtree, used by the admin preview. */
export function themeInlineStyle(theme: ForumTheme): string {
  return Object.entries(themeTokens(theme))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

/** Stylesheet text. Explicit mode emits Classic too, so personal choices override owner tokens. */
export function themeCss(theme: ForumTheme, explicit = false): string {
  const preset = themePreset(theme);
  if (!explicit && !Object.keys(preset.tokens).length) return '';
  const declarations = Object.entries(themeTokens(theme)).map(([name, value]) => `${name}:${value};`);
  declarations.push(`color-scheme:${preset.dark ? 'dark' : 'light'};`);
  return `:root{${declarations.join('')}}`;
}

/** Browser chrome color (`<meta name="theme-color">`) for a theme. */
export function themeColor(theme: ForumTheme): string {
  return themePreset(theme).swatches[0];
}
