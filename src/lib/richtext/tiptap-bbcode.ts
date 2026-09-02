import type { JSONContent } from '@tiptap/core';
import { quoteSubjectArg } from './bbcode';

interface Tag {
  key: string;
  open: string;
  close: string;
}

// Fixed nesting order: whichever marks are present on a run always open/close
// in this order, so overlapping runs still produce well-nested tag pairs.
const MARK_ORDER = ['link', 'bold', 'italic', 'underline', 'strike', 'spoiler'] as const;

function tagFor(mark: { type: string; attrs?: Record<string, unknown> }): Tag | null {
  switch (mark.type) {
    case 'bold':
      return { key: 'bold', open: '[b]', close: '[/b]' };
    case 'italic':
      return { key: 'italic', open: '[i]', close: '[/i]' };
    case 'underline':
      return { key: 'underline', open: '[u]', close: '[/u]' };
    case 'strike':
      return { key: 'strike', open: '[s]', close: '[/s]' };
    case 'spoiler':
      return { key: 'spoiler', open: '[spoiler]', close: '[/spoiler]' };
    case 'link': {
      const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
      return { key: `link:${href}`, open: `[url=${href}]`, close: '[/url]' };
    }
    default:
      return null;
  }
}

/** Serialize a paragraph/blockquote's inline text+marks into a BBCode-lite string. */
function serializeInline(nodes: JSONContent[] = []): string {
  let out = '';
  let open: Tag[] = [];
  for (const node of nodes) {
    if (node.type !== 'text') continue;
    const target = MARK_ORDER.map((name) => (node.marks ?? []).find((m) => m.type === name))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map(tagFor)
      .filter((t): t is Tag => !!t);

    let common = 0;
    while (common < open.length && common < target.length && open[common].key === target[common].key) common++;
    for (let i = open.length - 1; i >= common; i--) out += open[i].close;
    for (let i = common; i < target.length; i++) out += target[i].open;
    open = target;

    out += node.text ?? '';
  }
  for (let i = open.length - 1; i >= 0; i--) out += open[i].close;
  return out;
}

function serializeBlock(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return serializeInline(node.content);
    case 'blockquote': {
      const inner = (node.content ?? []).map((p) => serializeInline(p.content)).join('\n\n');
      const uri = typeof node.attrs?.subjectUri === 'string' ? node.attrs.subjectUri : '';
      const cid = typeof node.attrs?.subjectCid === 'string' ? node.attrs.subjectCid : '';
      const open = uri && cid ? `[quote=${quoteSubjectArg({ uri, cid })}]` : '[quote]';
      return inner.trim() ? `${open}\n${inner}\n[/quote]` : '';
    }
    case 'codeBlock': {
      const text = (node.content ?? []).map((t) => t.text ?? '').join('');
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : undefined;
      return `[code${lang ? `=${lang}` : ''}]\n${text}\n[/code]`;
    }
    case 'forumImage': {
      const cid = typeof node.attrs?.cid === 'string' ? node.attrs.cid : '';
      return cid ? `[img=${cid}]` : '';
    }
    default:
      return '';
  }
}

export function docToBBCode(doc: JSONContent): string {
  return (doc.content ?? [])
    .map(serializeBlock)
    .filter((s) => s.trim().length > 0)
    .join('\n\n');
}

export interface ImagePayload {
  blob: unknown;
  alt?: string;
}

/**
 * Gather every embedded image in the doc as a `cid → { blob, alt }` map — the
 * side-channel the composer submits so the server can pair each `[img=cid]`
 * token back to the BlobRef it must write into the record.
 */
export function collectImages(doc: JSONContent): Record<string, ImagePayload> {
  const out: Record<string, ImagePayload> = {};
  for (const node of doc.content ?? []) {
    if (node.type !== 'forumImage') continue;
    const cid = typeof node.attrs?.cid === 'string' ? node.attrs.cid : '';
    if (!cid || !node.attrs?.blob) continue;
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
    out[cid] = { blob: node.attrs.blob, ...(alt ? { alt } : {}) };
  }
  return out;
}
