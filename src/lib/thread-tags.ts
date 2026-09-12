export const MAX_THREAD_TAGS = 8;
export const MAX_THREAD_TAG_GRAPHEMES = 64;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function normalizeThreadTag(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseThreadTags(value: string): { tags: string[]; error?: string } {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/[,\n]/)) {
    const tag = normalizeThreadTag(raw);
    if (!tag || seen.has(tag)) continue;
    if ([...segmenter.segment(tag)].length > MAX_THREAD_TAG_GRAPHEMES) {
      return { tags, error: `Tags can be at most ${MAX_THREAD_TAG_GRAPHEMES} characters each.` };
    }
    if (new TextEncoder().encode(tag).length > 640) {
      return { tags, error: 'This tag is too long to store.' };
    }
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > MAX_THREAD_TAGS) {
    return { tags, error: `Add at most ${MAX_THREAD_TAGS} tags.` };
  }
  return { tags };
}
