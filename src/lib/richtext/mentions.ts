import type { Facet, RichTextBlock } from './bbcode';

const NS = 'app.atmobb.richtext';
const encoder = new TextEncoder();
const byteLen = (s: string) => encoder.encode(s).length;

// Domain-style atproto handles after a boundary (avoids matching emails).
// Group 2 is the handle; group 1 is the preceding boundary char.
const MENTION = /(^|[\s(])@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/gi;

export interface MentionSpan {
  handle: string;
  byteStart: number;
  byteEnd: number;
}

/** Find @handle spans in `text`, as UTF-8 byte offsets over the '@handle' run. */
export function detectMentions(text: string): MentionSpan[] {
  const out: MentionSpan[] = [];
  let m: RegExpExecArray | null;
  MENTION.lastIndex = 0;
  while ((m = MENTION.exec(text))) {
    const at = m.index + m[1].length; // index of '@'
    out.push({
      handle: m[2],
      byteStart: byteLen(text.slice(0, at)),
      byteEnd: byteLen(text.slice(0, at + 1 + m[2].length)),
    });
  }
  return out;
}

/** Build a #mention facet for a resolved handle at the given byte range. */
export function mentionFacet(did: string, byteStart: number, byteEnd: number): Facet {
  return { index: { byteStart, byteEnd }, features: [{ $type: `${NS}.facet#mention`, did }] };
}

/** Add already-resolved mention facets to a block, keeping facets byte-ordered. */
export function withFacets(block: RichTextBlock, extra: Facet[]): RichTextBlock {
  if (!extra.length) return block;
  const facets = [...(block.facets ?? []), ...extra].sort((a, b) => a.index.byteStart - b.index.byteStart);
  return { ...block, facets };
}
