import { describe, expect, it } from 'vitest';
import { markdownToDoc } from './markdown';
import { docToBBCode } from './tiptap-bbcode';
import { parseBBCode } from './bbcode';
import { blocksToDoc } from './blocks-tiptap';

const save = (source: string) => parseBBCode(docToBBCode(markdownToDoc(source)));

describe('Markdown paste', () => {
  it('saves headings, paragraphs, lists with non-default numbering, quotes, and fenced code', () => {
    const blocks = save('# Migration\n\nA paragraph.\n\n- First\n- Second\n\n7. Seven\n8. Eight\n\n> A quote\n\n```js\nconst x = "**literal**";\n```');
    expect(blocks).toEqual([
      { $type: 'app.atmobb.richtext.block#text', text: 'Migration', heading: 1 },
      { $type: 'app.atmobb.richtext.block#text', text: 'A paragraph.' },
      { $type: 'app.atmobb.richtext.block#text', text: 'First\nSecond', list: 'bullet' },
      { $type: 'app.atmobb.richtext.block#text', text: 'Seven\nEight', list: 'ordered', start: 7 },
      { $type: 'app.atmobb.richtext.block#quote', text: 'A quote' },
      { $type: 'app.atmobb.richtext.block#code', text: 'const x = "**literal**";', lang: 'js' },
    ]);
  });

  it('preserves Unicode offsets and inline code through save and reopen', () => {
    const blocks = save('é **猫** and `[h1]literal[/h1]`');
    expect(blocks[0].text).toBe('é 猫 and [h1]literal[/h1]');
    expect(blocks[0].facets).toEqual([
      { index: { byteStart: 3, byteEnd: 6 }, features: [{ $type: 'app.atmobb.richtext.facet#bold' }] },
      { index: { byteStart: 11, byteEnd: 27 }, features: [{ $type: 'app.atmobb.richtext.facet#code' }] },
    ]);
    expect(parseBBCode(docToBBCode(blocksToDoc(blocks)))).toEqual(blocks);
  });

  it('retains supported inline marks and only safe links', () => {
    const block = save('*italic* ~~gone~~ [safe](https://example.com) [unsafe](javascript:alert%281%29)')[0];
    expect(block.text).toBe('italic gone safe unsafe');
    expect(block.facets?.flatMap((f) => f.features)).toEqual([
      { $type: 'app.atmobb.richtext.facet#italic' },
      { $type: 'app.atmobb.richtext.facet#strikethrough' },
      { $type: 'app.atmobb.richtext.facet#link', uri: 'https://example.com' },
    ]);
  });

  it('keeps HTML, images, and unsupported nested lists literal', () => {
    for (const source of ['<script>alert(1)</script>', '![alt](https://example.com/a.png)', '- parent\n  - child']) {
      expect(save(source)).toEqual([{ $type: 'app.atmobb.richtext.block#text', text: source }]);
    }
    expect(save('line one\nline two')[0].text).toBe('line one\nline two');
    expect(save('\\*literal\\*')[0].text).toBe('*literal*');
  });
});
