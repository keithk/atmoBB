import { describe, expect, it } from 'vitest';
import {
  FORUM_THEMES,
  THEME_PRESETS,
  normalizeTheme,
  profileSkinStyle,
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
    expect(style.split(';').length).toBe(FORUM_TOKENS.length + 1);
  });

  it('carries the color-scheme hint so native controls match the skin', () => {
    expect(themeInlineStyle('midnight')).toContain('color-scheme:dark');
    expect(themeInlineStyle('sky')).toContain('color-scheme:light');
  });
});

describe('profileSkinStyle', () => {
  const utilityTokens = [...new Set(THEME_PRESETS.flatMap((preset) => Object.keys(preset.tokens)))]
    .filter((name) => !name.startsWith('--forum-'));

  it('declares every utility token any preset overrides, so a light skin never inherits dark status colors', () => {
    expect(utilityTokens).toContain('--danger-bg');
    for (const theme of FORUM_THEMES) {
      const style = profileSkinStyle(theme);
      for (const name of utilityTokens) expect(style, `${theme} is missing ${name}`).toContain(`${name}:`);
    }
  });

  it('uses the light :root defaults for light skins and the preset values for dark ones', () => {
    expect(profileSkinStyle('sky')).toContain('--danger-bg:#f6ded9');
    expect(profileSkinStyle('sky')).toContain('--shadow-lg:0 6px 24px rgba(33, 28, 22, 0.14)');
    expect(profileSkinStyle('midnight')).toContain('--danger-bg:#3a1c19');
  });

  it('re-derives the focus ring from the skinned accent and keeps the color-scheme hint', () => {
    const style = profileSkinStyle('midnight');
    expect(style).toContain('--focus-ring:0 0 0 3px color-mix(in oklch, var(--forum-accent) 40%, transparent)');
    expect(style).toContain('color-scheme:dark');
    expect(style).toContain('--forum-bg:#12131a');
  });
});
