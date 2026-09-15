import { isFontList, isThemeColor, type PanelTheme, type ThemeColor, type ThemeFont } from './bridge';

// Reads the forum page's theme for an extension panel, from the computed
// values of the tokens every built-in theme and owner stylesheet sets (see
// src/lib/styles/tokens/themes.css and docs/theming.md). Anything that isn't a
// valid color or a safe font-family list is left out.

/** The forum token each theme color comes from. */
export const COLOR_TOKENS: Record<ThemeColor, string> = {
  ground: '--forum-bg',
  surface: '--forum-surface',
  surfaceAlt: '--forum-surface-2',
  sunken: '--forum-sunken',
  line: '--forum-line',
  lineStrong: '--forum-line-strong',
  ink: '--forum-ink',
  inkSoft: '--forum-ink-soft',
  inkFaint: '--forum-ink-faint',
  accent: '--forum-accent',
  accentHover: '--forum-accent-hover',
  accentInk: '--forum-accent-ink',
  accentSoft: '--forum-accent-soft',
  link: '--forum-link',
  linkHover: '--forum-link-hover',
  ok: '--ok-1',
  okSoft: '--ok-bg',
  warn: '--warn-1',
  warnSoft: '--warn-bg',
  danger: '--danger-1',
  dangerSoft: '--danger-bg',
};

/** The forum token each theme font comes from. */
export const FONT_TOKENS: Record<ThemeFont, string> = {
  body: '--font-body',
  display: '--font-display',
  mono: '--font-mono',
};

export interface ThemeSource {
  /** The computed style of the root element, which carries the forum's tokens and its `color-scheme`. */
  root: Pick<CSSStyleDeclaration, 'getPropertyValue'>;
  /** The computed background color of the page's body. */
  background: string;
  /** Whether the viewer's system prefers dark. */
  prefersDark: boolean;
}

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/;

/**
 * Whether the page is showing light or dark. The body's background decides
 * when it's an opaque rgb color, which is how browsers report sRGB colors, so
 * an owner stylesheet that darkens the page without declaring `color-scheme`
 * still counts. Otherwise the root's `color-scheme` does, and the viewer's
 * system preference picks between `light dark`.
 */
export function forumScheme({ root, background, prefersDark }: ThemeSource): 'light' | 'dark' {
  const rgb = RGB.exec(background.trim());
  const alpha = rgb?.[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
  if (rgb && alpha > 0) {
    const [red, green, blue] = rgb.slice(1, 4).map(Number);
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 < 0.5 ? 'dark' : 'light';
  }
  const schemes = root.getPropertyValue('color-scheme').trim().split(/\s+/);
  return schemes.includes('dark') && (!schemes.includes('light') || prefersDark) ? 'dark' : 'light';
}

/** The forum page's theme, as a panel is told it. */
export function readForumTheme(source: ThemeSource): PanelTheme {
  const valid = <Name extends string>(tokens: Record<Name, string>, check: (value: string) => boolean) =>
    Object.fromEntries(
      Object.entries<string>(tokens)
        .map(([name, token]) => [name, source.root.getPropertyValue(token).trim()])
        .filter(([, value]) => check(value)),
    ) as Partial<Record<Name, string>>;
  return { scheme: forumScheme(source), colors: valid(COLOR_TOKENS, isThemeColor), fonts: valid(FONT_TOKENS, isFontList) };
}
