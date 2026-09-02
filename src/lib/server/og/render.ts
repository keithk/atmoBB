import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { loadFonts } from './fonts';
import { emojiImage } from './emoji';
import { OG } from './palette';

type Style = Record<string, string | number>;
export interface VNode {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}
type Child = VNode | string | number | null | undefined | false;

/** Hyperscript for satori's React-element shape. Falsy children are dropped. */
export function h(type: string, props: Record<string, unknown> = {}, ...children: Child[]): VNode {
  const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) as (
    | VNode
    | string
    | number
  )[];
  const kids = flat.length === 0 ? props.children : flat.length === 1 ? flat[0] : flat;
  return { type, props: { ...props, children: kids } };
}

/** A flex box. Satori requires an explicit display on any multi-child node. */
export const box = (style: Style, ...children: Child[]): VNode =>
  h('div', { style: { display: 'flex', ...style } }, ...children);

/** A single run of text in its own box (keeps satori's layout rules happy). */
export const text = (style: Style, value: string | number): VNode =>
  h('div', { style: { display: 'flex', ...style } }, String(value));

/** An <img> from a data/URL source at an explicit size. */
export const img = (src: string, style: Style = {}): VNode => h('img', { src, style });

/** Render an element tree to a PNG buffer at 1200×630 (overridable). */
export async function renderPng(
  node: VNode,
  { width = OG.width, height = OG.height }: { width?: number; height?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const fonts = await loadFonts();
  const svg = await satori(node, {
    width,
    height,
    fonts,
    // Satori requests an image for each emoji grapheme; everything else is Latin
    // and covered by the loaded fonts, so we only answer 'emoji'.
    loadAdditionalAsset: (code, segment) => (code === 'emoji' ? emojiImage(segment) : Promise.resolve('')),
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  // Copy into a fresh ArrayBuffer-backed view so the bytes satisfy BodyInit
  // (resvg hands back a Buffer<ArrayBufferLike>, which the DOM lib rejects).
  const out = new Uint8Array(png.length);
  out.set(png);
  return out;
}

/** A cacheable PNG response. A raster only changes when the page's content does. */
export const pngResponse = (bytes: Uint8Array<ArrayBuffer>, maxAge = 300): Response =>
  new Response(new Blob([bytes], { type: 'image/png' }), {
    headers: {
      'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400`,
    },
  });
