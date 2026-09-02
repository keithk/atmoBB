import { BlobRef, jsonToLex } from '@atproto/api';
import type { RichTextBlock } from '$lib/richtext/bbcode';
import { imageCid } from '$lib/richtext/blocks-tiptap';
import { blobUrl } from './profiles';

interface ImagePayload {
  blob: unknown;
  alt?: string;
}

/**
 * Replace each image placeholder with a block carrying its uploaded BlobRef.
 * `imagesRaw` is the JSON `cid → { blob, alt }` map the composer submits.
 * Placeholders with no matching (or malformed) blob are dropped rather than
 * written as invalid records.
 */
export function attachImages(blocks: RichTextBlock[], imagesRaw: string): RichTextBlock[] {
  let map: Record<string, ImagePayload> = {};
  try {
    if (imagesRaw) map = JSON.parse(imagesRaw);
  } catch {
    map = {};
  }
  const out: RichTextBlock[] = [];
  for (const block of blocks) {
    if (!block.$type.endsWith('#image')) {
      out.push(block);
      continue;
    }
    const payload = block.cid ? map[block.cid] : undefined;
    if (!payload?.blob) continue;
    // The composer ships the blob as JSON ({$type:'blob',ref:{$link},…}); rebuild
    // the BlobRef the record write expects. Skip anything that isn't a blob.
    const image = jsonToLex(payload.blob);
    if (!(image instanceof BlobRef)) continue;
    out.push({
      $type: block.$type,
      image,
      ...(payload.alt ? { alt: payload.alt } : {}),
    });
  }
  return out;
}

/**
 * Attach a display `url` (a getBlob URL on the author's PDS) to every #image
 * block in these post bodies. Each author's PDS is resolved once (cached). The
 * blocks are the caller's freshly-fetched copies, so we mutate in place.
 */
export async function resolveBodyImages(
  items: { author: string; body?: RichTextBlock[] }[],
): Promise<void> {
  await Promise.all(
    items.flatMap((item) =>
      (item.body ?? [])
        .filter((b) => b.$type.endsWith('#image'))
        .map(async (block) => {
          const cid = imageCid(block);
          if (cid) block.url = await blobUrl(item.author, cid);
        }),
    ),
  );
}
