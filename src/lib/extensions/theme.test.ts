import { describe, expect, it } from 'vitest';
import { THEME_COLORS, THEME_FONTS } from './bridge';
import { COLOR_TOKENS, FONT_TOKENS, forumScheme, readForumTheme } from './theme';
import { themeTokens } from '$lib/themes';

const style = (values: Record<string, string>) => ({ getPropertyValue: (name: string) => values[name] ?? '' });

const CLASSIC = {
  ...themeTokens('classic'),
  '--ok-1': '#2f7d55',
  '--ok-bg': '#e0efe4',
  '--warn-1': '#b06f13',
  '--warn-bg': '#f6ecd6',
  '--danger-1': '#b23b2c',
  '--danger-bg': '#f6ded9',
  // Computed custom properties keep the whitespace they were written with.
  '--font-body': " 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
  '--font-display': "'Trebuchet MS', 'IBM Plex Sans', system-ui, sans-serif",
  '--font-mono': "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace",
};

describe('readForumTheme', () => {
  it('maps every theme name to a forum token the built-in themes set', () => {
    expect(Object.keys(COLOR_TOKENS).sort()).toEqual([...THEME_COLORS].sort());
    expect(Object.keys(FONT_TOKENS).sort()).toEqual([...THEME_FONTS].sort());
    const midnight = themeTokens('midnight');
    for (const token of Object.values(COLOR_TOKENS)) expect(midnight, token).toHaveProperty(token);
  });

  it("reads the forum's colors and fonts from its computed tokens", () => {
    const theme = readForumTheme({ root: style(CLASSIC), background: 'rgb(236, 234, 231)', prefersDark: true });
    expect(theme.scheme).toBe('light');
    expect(theme.colors).toMatchObject({ ground: '#eceae7', surface: '#ffffff', surfaceAlt: '#f4f2ef', accent: '#f79b7a', accentInk: '#4a2a1c', link: '#c05a37', ok: '#2f7d55', dangerSoft: '#f6ded9' });
    expect(Object.keys(theme.colors).sort()).toEqual([...THEME_COLORS].sort());
    expect(theme.fonts).toEqual({
      body: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
      display: "'Trebuchet MS', 'IBM Plex Sans', system-ui, sans-serif",
      mono: "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace",
    });
  });

  it('leaves out a token that is missing, not a color, or not a safe font list', () => {
    const theme = readForumTheme({
      root: style({ ...CLASSIC, '--forum-bg': '', '--forum-accent': 'url(https://tracker.example/x.png)', '--font-body': "'Forum Text', Georgia, serif", '--font-mono': '' }),
      background: 'rgb(236, 234, 231)',
      prefersDark: false,
    });
    expect(theme.colors).not.toHaveProperty('ground');
    expect(theme.colors).not.toHaveProperty('accent');
    expect(theme.colors).toHaveProperty('surface', '#ffffff');
    expect(theme.fonts).toEqual({ display: CLASSIC['--font-display'] });
  });
});

describe('forumScheme', () => {
  it("judges the scheme by the page's background when it's an opaque rgb color", () => {
    expect(forumScheme({ root: style({}), background: 'rgb(18, 19, 26)', prefersDark: false })).toBe('dark');
    expect(forumScheme({ root: style({ 'color-scheme': 'dark' }), background: 'rgb(253, 240, 245)', prefersDark: true })).toBe('light');
    expect(forumScheme({ root: style({}), background: 'rgba(18, 19, 26, 0.95)', prefersDark: false })).toBe('dark');
    expect(forumScheme({ root: style({}), background: 'rgb(18 19 26 / 100%)', prefersDark: false })).toBe('dark');
  });

  it("falls back to the root's color-scheme, and the viewer's preference when it allows both", () => {
    for (const background of ['rgba(0, 0, 0, 0)', 'oklch(0.2 0.02 270)', '']) {
      expect(forumScheme({ root: style({ 'color-scheme': 'dark' }), background, prefersDark: false })).toBe('dark');
      expect(forumScheme({ root: style({ 'color-scheme': 'light' }), background, prefersDark: true })).toBe('light');
      expect(forumScheme({ root: style({ 'color-scheme': 'normal' }), background, prefersDark: true })).toBe('light');
      expect(forumScheme({ root: style({ 'color-scheme': 'light dark' }), background, prefersDark: true })).toBe('dark');
      expect(forumScheme({ root: style({ 'color-scheme': 'light dark' }), background, prefersDark: false })).toBe('light');
    }
  });
});
