import type { RichTextBlock } from './bbcode';

/**
 * A post body as plain text, for quoting it: text and quote blocks keep
 * their words, code keeps its lines, images are left out. Facets are
 * dropped; the reader can follow the attribution to the original.
 */
export function blocksToPlainText(blocks: RichTextBlock[] = []): string {
  return blocks
    .filter((b) => !b.$type.endsWith('#image'))
    .map((b) => (b.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}
