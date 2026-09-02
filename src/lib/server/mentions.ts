import type { RichTextBlock } from '$lib/richtext/bbcode';
import { detectMentions, mentionFacet, withFacets } from '$lib/richtext/mentions';
import { resolveMentionDid } from './profiles';

/**
 * For every text/quote block, detect @handle mentions and attach #mention facets
 * for the ones that resolve to a DID (unresolvable handles stay plain text).
 * Best-effort and order-preserving; never throws on a bad handle.
 */
export async function addMentionFacets(blocks: RichTextBlock[]): Promise<RichTextBlock[]> {
  return Promise.all(
    blocks.map(async (block) => {
      if (!block.text || block.$type.endsWith('#code')) return block;
      const spans = detectMentions(block.text);
      if (!spans.length) return block;
      const resolved = await Promise.all(
        spans.map(async (s) => {
          const did = await resolveMentionDid(s.handle);
          return did ? mentionFacet(did, s.byteStart, s.byteEnd) : null;
        }),
      );
      return withFacets(block, resolved.filter((f): f is NonNullable<typeof f> => f !== null));
    }),
  );
}
