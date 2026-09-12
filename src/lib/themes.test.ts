import { describe, expect, it } from 'vitest';
import {
  FORUM_THEMES,
  THEME_PRESETS,
  normalizeTheme,
  themeCss,
  themeInlineStyle,
  themeTokens,
} from './themes';

const FORUM_TOKENS = [
  '--forum-bg', '--forum-surface', '--forum-surface-2', '--forum-sunken',
  '--forum-line', '--forum-line-strong', '--forum-edge', '--forum-bevel',
  '--forum-ink', '--forum-ink-soft', '--forum-ink-faint',
  '--forum-accent', '--forum-accent-hover', '--forum-accent-ink', '--forum-accent-soft',
  '--forum-link', '--forum-link-hover',
  '--forum-cat-bg', '--forum-cat-ink', '--forum-cat-edge',
  '--forum-header-bg', '--forum-header-ink',
  '--forum-pin-bg', '--forum-pin-edge',
  '--forum-rank', '--forum-rank-bg',
];

describe('normalizeTheme', () => {
  it('falls back to classic for missing, unknown, and non-string values', () => {
    expect(normalizeTheme(undefined)).toBe('classic');
    expect(normalizeTheme('neon')).toBe('classic');
    expect(normalizeTheme('Midnight')).toBe('classic');
    expect(normalizeTheme(42)).toBe('classic');
  });

  it('keeps every known theme', () => {
    for (const theme of FORUM_THEMES) expect(normalizeTheme(theme)).toBe(theme);
  });
});

describe('theme presets', () => {
  it('lists every theme exactly once, classic first', () => {
    expect(THEME_PRESETS.map((preset) => preset.value)).toEqual([...FORUM_THEMES]);
    expect(THEME_PRESETS[0].value).toBe('classic');
  });

  it('defines the complete --forum-* token set for every theme so no component is half-skinned', () => {
    for (const theme of FORUM_THEMES) {
      const tokens = themeTokens(theme);
      for (const name of FORUM_TOKENS) {
        expect(tokens[name], `${theme} is missing ${name}`).toBeTruthy();
      }
    }
  });
});

describe('themeCss', () => {
  it('emits nothing for classic, whose values are the built-in defaults', () => {
    expect(themeCss('classic')).toBe('');
  });

  it('emits a single :root rule with every token and a color-scheme hint', () => {
    const css = themeCss('midnight');
    expect(css.startsWith(':root{')).toBe(true);
    expect(css.endsWith('}')).toBe(true);
    expect(css).toContain('--forum-bg:#12131a;');
    expect(css).toContain('color-scheme:dark;');
    expect(themeCss('sky')).toContain('color-scheme:light;');
  });

  it('never wraps output in the atmobb layer, so owner CSS still wins by order', () => {
    for (const theme of FORUM_THEMES) expect(themeCss(theme)).not.toContain('@layer');
  });
});

describe('themeInlineStyle', () => {
  it('spells out classic tokens so the preview can show the default next to the others', () => {
    const style = themeInlineStyle('classic');
    expect(style).toContain('--forum-accent:#f79b7a');
    expect(style.split(';').length).toBe(FORUM_TOKENS.length);
  });
});
