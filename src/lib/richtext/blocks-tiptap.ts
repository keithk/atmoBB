import type { JSONContent } from '@tiptap/core';
import type { Facet, FacetFeature, RichTextBlock } from './bbcode';

type Mark = NonNullable<JSONContent['marks']>[number];

/** The blob CID an #image block carries, whether the ref is a BlobRef or its JSON form. */
export function imageCid(block: RichTextBlock): string | undefined {
  const ref = (block.image as { ref?: unknown } | undefined)?.ref;
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object') {
    const link = (ref as { $link?: string }).$link;
    return link ?? String(ref);
  }
  return undefined;
}

// Mentions and tags aren't marks: their text stays in the run and the server
// resolves them again on save, the same way it does for a fresh post.
function markFor(feature: FacetFeature): Mark | null {
  switch (feature.$type.split('#')[1]) {
    case 'bold':
      return { type: 'bold' };
    case 'italic':
      return { type: 'italic' };
    case 'underline':
      return { type: 'underline' };
    case 'strikethrough':
      return { type: 'strike' };
    case 'spoiler':
      return { type: 'spoiler' };
    case 'link':
      return feature.uri ? { type: 'link', attrs: { href: feature.uri } } : null;
    default:
      return null;
  }
}

/** Split text at every facet boundary into runs, each with the marks that cover it. */
function runs(text: string, facets: Facet[] = []): JSONContent[] {
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const bounds = new Set([0, bytes.length]);
  for (const f of facets) {
    bounds.add(Math.max(0, Math.min(bytes.length, f.index.byteStart)));
    bounds.add(Math.max(0, Math.min(bytes.length, f.index.byteEnd)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  const out: JSONContent[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [s, e] = [points[i], points[i + 1]];
    if (s >= e) continue;
    const seen = new Set<string>();
    const marks: Mark[] = [];
    for (const f of facets) {
      if (f.index.byteStart > s || f.index.byteEnd < e) continue;
      for (const feature of f.features) {
        const mark = markFor(feature);
        if (mark && !seen.has(mark.type)) {
          seen.add(mark.type);
          marks.push(mark);
        }
      }
    }
    out.push({ type: 'text', text: decoder.decode(bytes.slice(s, e)), ...(marks.length ? { marks } : {}) });
  }
  return out;
}

/**
 * A stored post body as a Tiptap document, so the editor can reopen it. The
 * inverse of the composer's docToBBCode + parseBBCode round trip; image
 * nodes keep their BlobRef so saving carries existing images through.
 */
export function blocksToDoc(blocks: RichTextBlock[] = []): JSONContent {
  const content: JSONContent[] = [];
  for (const block of blocks) {
    switch (block.$type.split('#')[1]) {
      case 'text':
        content.push({ type: 'paragraph', content: runs(block.text ?? '', block.facets) });
        break;
      case 'quote':
        content.push({
          type: 'blockquote',
          attrs: { subjectUri: block.subject?.uri ?? null, subjectCid: block.subject?.cid ?? null },
          content: [{ type: 'paragraph', content: runs(block.text ?? '', block.facets) }],
        });
        break;
      case 'code':
        content.push({
          type: 'codeBlock',
          attrs: { language: block.lang ?? null },
          content: block.text ? [{ type: 'text', text: block.text }] : [],
        });
        break;
      case 'image': {
        const cid = imageCid(block);
        if (!cid) break;
        content.push({
          type: 'forumImage',
          attrs: { src: block.url ?? null, cid, blob: block.image, alt: block.alt ?? '' },
        });
        break;
      }
    }
  }
  return { type: 'doc', content };
}
