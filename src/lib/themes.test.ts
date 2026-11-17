import { describe, expect, it } from 'vitest';
import {
  FORUM_THEMES,
  THEME_PRESETS,
  knownTheme,
  normalizeTheme,
  profileSkinStyle,
  themeColors,
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
  '--forum-lock-bg', '--forum-lock-edge',
  '--forum-rank', '--forum-rank-bg',
];

describe('normalizeTheme', () => {
  it('falls back to coral for missing, unknown, and non-string values', () => {
    expect(normalizeTheme(undefined)).toBe('coral');
    expect(normalizeTheme('neon')).toBe('coral');
    expect(normalizeTheme('Midnight')).toBe('coral');
    expect(normalizeTheme(42)).toBe('coral');
  });

  it('keeps every known theme', () => {
    for (const theme of FORUM_THEMES) expect(normalizeTheme(theme)).toBe(theme);
  });
});

describe('knownTheme', () => {
  it('follows the names earlier releases stored', () => {
    expect(knownTheme('classic')).toBe('coral');
    expect(knownTheme('forest')).toBe('coral');
    expect(knownTheme('sky')).toBe('atmosphere');
  });

  it('is undefined for anything that never named a theme', () => {
    expect(knownTheme('neon')).toBeUndefined();
    expect(knownTheme('constructor')).toBeUndefined();
    expect(knownTheme('')).toBeUndefined();
    expect(knownTheme(null)).toBeUndefined();
  });
});

describe('theme presets', () => {
  it('lists every theme exactly once', () => {
    expect(THEME_PRESETS.map((preset) => preset.value)).toEqual([...FORUM_THEMES]);
  });

  it('defines the complete --forum-* token set for every theme so no component is half-skinned', () => {
    for (const theme of FORUM_THEMES) {
      const tokens = themeTokens(theme);
      for (const name of FORUM_TOKENS) {
        expect(tokens[name], `${theme} is missing ${name}`).toBeTruthy();
      }
    }
  });

  it('gives a light theme a dark value for every token, and a dark theme none', () => {
    for (const preset of THEME_PRESETS) {
      if (preset.dark) expect(preset.darkTokens, preset.value).toBeUndefined();
      else expect(Object.keys(preset.darkTokens ?? {}).sort(), preset.value).toEqual(Object.keys(preset.tokens).sort());
    }
  });
});

/** WCAG 2.x contrast ratio between two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('theme contrast', () => {
  // Every mode a visitor can see: a light theme's two, a dark theme's one.
  const modes = THEME_PRESETS.flatMap((preset) => [
    { name: preset.dark ? preset.value : `${preset.value} light`, tokens: preset.tokens },
    ...(preset.darkTokens ? [{ name: `${preset.value} dark`, tokens: { ...preset.tokens, ...preset.darkTokens } }] : []),
  ]);
  // The surfaces body text sits on. The category and header bands carry their own inks.
  const surfaces = ['--forum-bg', '--forum-surface', '--forum-surface-2', '--forum-sunken', '--forum-pin-bg', '--forum-lock-bg'];
  const inks = ['--forum-ink', '--forum-ink-soft', '--forum-ink-faint', '--forum-link'];

  it('keeps every text color at 4.5:1 on every surface (WCAG 1.4.3)', () => {
    for (const { name, tokens } of modes) {
      for (const ink of inks) {
        for (const surface of surfaces) {
          const ratio = contrast(tokens[ink], tokens[surface]);
          expect(ratio, `${name}: ${ink} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps button text and the category and header bands at 4.5:1', () => {
    const pairs = [
      ['--forum-accent-ink', '--forum-accent'],
      ['--forum-cat-ink', '--forum-cat-bg'],
      ['--forum-header-ink', '--forum-header-bg'],
    ];
    for (const { name, tokens } of modes) {
      for (const [ink, surface] of pairs) {
        const ratio = contrast(tokens[ink], tokens[surface]);
        expect(ratio, `${name}: ${ink} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('themeCss', () => {
  it('writes a light theme\'s colors as light-dark() pairs that follow the visitor\'s scheme', () => {
    const css = themeCss('coral');
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain('--forum-bg:light-dark(#eceae7, #1c1a19);');
    expect(css).toContain('color-scheme:light dark;');
  });

  it('keeps a token that is the same in both modes as one plain value', () => {
    expect(themeCss('coral')).toContain('--forum-accent:#f79b7a;');
  });

  it('moves dark shadows into a media query, since light-dark() only takes colors', () => {
    const css = themeCss('coral');
    expect(css).toContain('--shadow-lg:0 6px 24px rgba(33, 28, 22, 0.14);');
    expect(css).toContain('@media (prefers-color-scheme: dark){:root{--shadow-sm:0 1px 0 rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.4);');
  });

  it('pins a dark theme to its one set of values', () => {
    const css = themeCss('midnight');
    expect(css).toContain('--forum-bg:#12131a;');
    expect(css).toContain('color-scheme:dark;');
    expect(css).not.toContain('light-dark(');
    expect(css).not.toContain('@media (prefers-color-scheme: dark){:root');
  });

  it('never puts tokens in a layer, so owner CSS still wins by order', () => {
    for (const theme of FORUM_THEMES) expect(themeCss(theme).split('\n')[0]).not.toContain('@layer');
  });

  it('wraps a theme\'s layout rules in the atmobb-theme layer, below owner CSS', () => {
    const css = themeCss('atmosphere');
    expect(css).toContain('@layer atmobb-theme{');
    expect(css).toContain('.atm-sidebar-nav__link');
    expect(themeCss('coral')).not.toContain('@layer');
  });
});

describe('themeInlineStyle', () => {
  it('carries every token, the color-scheme hint, and a focus ring from the skinned colors', () => {
    const style = themeInlineStyle('coral');
    expect(style).toContain('--forum-accent:#f79b7a');
    expect(style).toContain('--forum-bg:light-dark(#eceae7, #1c1a19)');
    expect(style).toContain('color-scheme:light dark');
    expect(style).toContain('--focus-ring:0 0 0 2px var(--forum-surface), 0 0 0 4px var(--forum-link)');
    expect(themeInlineStyle('midnight')).toContain('color-scheme:dark');
  });
});

describe('profileSkinStyle', () => {
  const utilityTokens = Object.keys(themeTokens('coral')).filter((name) => !name.startsWith('--forum-'));

  it('declares every utility token, so a light skin never inherits dark status colors', () => {
    expect(utilityTokens).toContain('--danger-bg');
    for (const theme of FORUM_THEMES) {
      const style = profileSkinStyle(theme);
      for (const name of utilityTokens) expect(style, `${theme} is missing ${name}`).toContain(`${name}:`);
    }
  });

  it('pairs light and dark status colors for light skins and uses the dark ones for dark skins', () => {
    expect(profileSkinStyle('atmosphere')).toContain('--danger-bg:light-dark(#f6ded9, #3a1c19)');
    expect(profileSkinStyle('atmosphere')).toContain('--shadow-lg:0 6px 24px rgba(33, 28, 22, 0.14)');
    expect(profileSkinStyle('midnight')).toContain('--danger-bg:#3a1c19');
  });
});

describe('themeColors', () => {
  it('gives the page background for each mode', () => {
    expect(themeColors('coral')).toEqual({ light: '#eceae7', dark: '#1c1a19' });
    expect(themeColors('midnight')).toEqual({ light: '#12131a', dark: '#12131a' });
  });
});
