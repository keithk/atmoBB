import { read } from '$app/server';
import monoRanges from '@fontsource/ibm-plex-mono/unicode.json';
import sansRanges from '@fontsource/ibm-plex-sans/unicode.json';

// The forum's own UI faces, IBM Plex Sans and IBM Plex Mono, for extension
// panel frames. The forum page loads them from Google Fonts, but a frame's
// policy names no third party: it may load this one stylesheet and the font
// files beside it, served from the forum itself, and no other stylesheet or
// font outside its own UI directory. The weights and styles match what the
// forum page asks Google for (src/lib/styles/tokens/fonts.css). The files come
// from the Fontsource packages at build time, so they ship in the build.

export const FONTS_DIRECTORY = '/x/fonts/';
export const FONTS_STYLESHEET = `${FONTS_DIRECTORY}fonts.css`;

const FILE_URLS = import.meta.glob<string>(
  [
    '/node_modules/@fontsource/ibm-plex-sans/files/*-{400,500,600,700}-normal.woff2',
    '/node_modules/@fontsource/ibm-plex-sans/files/*-{400,500}-italic.woff2',
    '/node_modules/@fontsource/ibm-plex-mono/files/*-{400,500,600}-normal.woff2',
  ],
  { query: '?url', import: 'default', eager: true },
);

const FAMILIES: Record<string, { name: string; ranges: Record<string, string> }> = {
  'ibm-plex-sans': { name: 'IBM Plex Sans', ranges: sansRanges },
  'ibm-plex-mono': { name: 'IBM Plex Mono', ranges: monoRanges },
};

const FILE_NAME = /^(ibm-plex-(?:sans|mono))-([a-z-]+)-(\d00)-(normal|italic)\.woff2$/;

/** Each font file's name, as served below the fonts directory, to its build asset URL. */
const FILES = new Map(Object.entries(FILE_URLS).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]));

/** The stylesheet declaring every face, each pointing at its file beside the stylesheet. */
export const fontsStylesheet = [...FILES.keys()]
  .sort()
  .map((file) => {
    const [, family, subset, weight, style] = FILE_NAME.exec(file) ?? [];
    const face = FAMILIES[family];
    if (!face || !Object.hasOwn(face.ranges, subset)) return '';
    return `@font-face{font-family:'${face.name}';font-style:${style};font-weight:${weight};font-display:swap;src:url(${file}) format('woff2');unicode-range:${face.ranges[subset]};}`;
  })
  .filter(Boolean)
  .join('\n');

function fontHeaders(): Headers {
  return new Headers({
    'x-content-type-options': 'nosniff',
    // A panel's document has an opaque origin, so every load from it is cross-origin, and fonts load in CORS mode.
    'cross-origin-resource-policy': 'cross-origin',
    'access-control-allow-origin': '*',
    'referrer-policy': 'no-referrer',
  });
}

/**
 * The response to a request for the fonts stylesheet or one of its files.
 * The stylesheet goes only to a style destination and a font file only to a
 * font destination; anything else, or a request that doesn't say what loads
 * it, is refused. Nothing here reads or sets cookies.
 */
export async function fontsResponse(file: string, headers: Headers): Promise<Response> {
  const refuse = (status: number, message: string) => {
    const refusal = fontHeaders();
    refusal.set('content-type', 'text/plain; charset=utf-8');
    refusal.set('cache-control', 'no-store');
    return new Response(message, { status, headers: refusal });
  };

  const destination = headers.get('sec-fetch-dest');
  const url = FILES.get(file);
  if (file !== 'fonts.css' && !url) return refuse(404, 'Not found');
  if (destination !== (url ? 'font' : 'style')) return refuse(403, 'Forbidden');

  const response = fontHeaders();
  // The faces change only with a release of the forum.
  response.set('cache-control', 'public, max-age=86400');
  if (!url) {
    response.set('content-type', 'text/css; charset=utf-8');
    return new Response(fontsStylesheet, { status: 200, headers: response });
  }
  response.set('content-type', 'font/woff2');
  return new Response(await read(url).arrayBuffer(), { status: 200, headers: response });
}
