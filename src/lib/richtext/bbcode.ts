const NS = 'app.atmobb.richtext';

export interface FacetFeature {
  $type: string;
  uri?: string;
  /** #mention — the mentioned account's DID. */
  did?: string;
  /** #tag — the hashtag without its leading '#'. */
  tag?: string;
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: FacetFeature[];
}

export interface RichTextBlock {
  $type: string;
  text?: string;
  lang?: string;
  facets?: Facet[];
  /** #image — the uploaded blob (BlobRef on the wire; JSON in transit). */
  image?: unknown;
  alt?: string;
  /** Transient: the blob CID an [img=] placeholder carries until the server
   *  swaps in the real BlobRef from the composer's images side-channel. */
  cid?: string;
  /** Display-only: a resolved getBlob URL, attached when a thread is loaded. */
  url?: string;
  /** #quote — the record being quoted, when the quote came from a post. */
  subject?: { uri: string; cid: string };
}

/** The `[quote=…]` argument that names a quoted record: `<at-uri>|<cid>`. */
export function parseQuoteSubject(arg?: string): { uri: string; cid: string } | undefined {
  if (!arg) return undefined;
  const bar = arg.indexOf('|');
  if (bar <= 0) return undefined;
  const uri = arg.slice(0, bar);
  const cid = arg.slice(bar + 1);
  return uri.startsWith('at://') && cid ? { uri, cid } : undefined;
}

export const quoteSubjectArg = (subject: { uri: string; cid: string }) => `${subject.uri}|${subject.cid}`;

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

const INLINE_TAGS = new Set(['b', 'i', 'u', 's', 'spoiler', 'url']);
const INLINE_TAG_RE = /\[(\/?)(b|i|u|s|spoiler|url)(?:=([^\]]*))?\]/gi;
// Block-level constructs, scanned in document order: paired [quote]/[code], or a
// self-closing [img=<cid>] whose blob rides the composer's images side-channel.
const BLOCK_RE = /\[(quote|code)(?:=([^\]]*))?\]([\s\S]*?)\[\/\1\]|\[img=([^\]\s]+)\]/gi;

function featureFor(tag: string, arg?: string): FacetFeature {
  switch (tag) {
    case 'b':
      return { $type: `${NS}.facet#bold` };
    case 'i':
      return { $type: `${NS}.facet#italic` };
    case 'u':
      return { $type: `${NS}.facet#underline` };
    case 's':
      return { $type: `${NS}.facet#strikethrough` };
    case 'spoiler':
      return { $type: `${NS}.facet#spoiler` };
    default:
      return { $type: `${NS}.facet#link`, uri: arg ?? '' };
  }
}

/**
 * Strip inline [b]/[i]/[u]/[s]/[spoiler]/[url=] tags from `src`, returning the
 * clean text plus byte-offset facets for each recognized span. Unmatched
 * closing tags are left as literal text; unmatched opening tags are dropped
 * (no facet, tag disappears) rather than failing on malformed input.
 */
export function parseInline(src: string): { text: string; facets?: Facet[] } {
  let clean = '';
  const facets: Facet[] = [];
  const stack: { tag: string; start: number; uri?: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_TAG_RE.lastIndex = 0;
  while ((m = INLINE_TAG_RE.exec(src))) {
    clean += src.slice(last, m.index);
    last = m.index + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!INLINE_TAGS.has(tag)) continue;
    if (!closing) {
      stack.push({ tag, start: byteLength(clean), uri: m[3] });
      continue;
    }
    const idx = stack.map((s) => s.tag).lastIndexOf(tag);
    if (idx === -1) {
      clean += m[0];
      continue;
    }
    const [open] = stack.splice(idx, 1);
    const end = byteLength(clean);
    if (end > open.start) {
      facets.push({ index: { byteStart: open.start, byteEnd: end }, features: [featureFor(tag, open.uri)] });
    }
  }
  clean += src.slice(last);
  facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
  return { text: clean, facets: facets.length ? facets : undefined };
}

function pushParagraphs(blocks: RichTextBlock[], segment: string): void {
  for (const raw of segment.split(/\n{2,}/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const { text, facets } = parseInline(trimmed);
    if (!text) continue;
    blocks.push({ $type: `${NS}.block#text`, text, ...(facets ? { facets } : {}) });
  }
}

/** Parse a composer's raw BBCode-lite text into richtext blocks for the wire. */
export function parseBBCode(raw: string): RichTextBlock[] {
  const text = raw.replace(/\r\n/g, '\n');
  const blocks: RichTextBlock[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(text))) {
    pushParagraphs(blocks, text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[4]) {
      // [img=<cid>] — a placeholder; the caller resolves the CID to a BlobRef.
      blocks.push({ $type: `${NS}.block#image`, cid: m[4] });
      continue;
    }
    const kind = m[1].toLowerCase();
    const inner = m[3];
    if (kind === 'code') {
      const trimmed = inner.replace(/^\n/, '').replace(/\n$/, '');
      if (trimmed.trim()) blocks.push({ $type: `${NS}.block#code`, text: trimmed, ...(m[2] ? { lang: m[2] } : {}) });
    } else {
      const { text: qText, facets } = parseInline(inner.trim());
      const subject = parseQuoteSubject(m[2]);
      if (qText) {
        blocks.push({
          $type: `${NS}.block#quote`,
          text: qText,
          ...(facets ? { facets } : {}),
          ...(subject ? { subject } : {}),
        });
      }
    }
  }
  pushParagraphs(blocks, text.slice(last));
  return blocks;
}
