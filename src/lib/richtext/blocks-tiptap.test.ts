import { describe, expect, it } from 'vitest';
import { blocksToDoc } from './blocks-tiptap';
import { collectImages, docToBBCode } from './tiptap-bbcode';
import { parseBBCode, type RichTextBlock } from './bbcode';

const NS = 'app.atmobb.richtext';
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('blocksToDoc', () => {
  it('preserves all heading levels, separate lists, numbering, and Unicode inline styles', () => {
    const raw = '[h1]Title[/h1]\n\n[h2][i]Section[/i][/h2]\n\n[h3]Detail[/h3]\n\n[list]\n[b]café[/b]\nSecond [i]猫[/i]\n[/list]\n\n[list=7]\nSeven\nEight\n[/list]\n\nAfter';
    const blocks = parseBBCode(raw);
    expect(blocks.map((b) => b.heading)).toEqual([1, 2, 3, undefined, undefined, undefined]);
    expect(blocks[3]).toEqual({
      $type: `${NS}.block#text`, text: 'café\nSecond 猫', list: 'bullet',
      facets: [
        { index: { byteStart: 0, byteEnd: 5 }, features: [{ $type: `${NS}.facet#bold` }] },
        { index: { byteStart: 13, byteEnd: 16 }, features: [{ $type: `${NS}.facet#italic` }] },
      ],
    });
    const doc = blocksToDoc(blocks);
    expect(doc.content?.[3].content?.[1].content?.[0].content).toEqual([
      { type: 'text', text: 'Second ' },
      { type: 'text', text: '猫', marks: [{ type: 'italic' }] },
    ]);
    expect(doc.content?.[4].attrs).toEqual({ start: 7 });
    expect(docToBBCode(doc)).toBe(raw);
    expect(parseBBCode(docToBBCode(doc))).toEqual(blocks);
  });

  it('clips a facet spanning list items and keeps block syntax literal in code', () => {
    const doc = blocksToDoc(parseBBCode('[list]\n[b]é\n猫[/b]\n[/list]'));
    expect(doc.content?.[0].content?.map((item) => item.content?.[0].content)).toEqual([
      [{ type: 'text', text: 'é', marks: [{ type: 'bold' }] }],
      [{ type: 'text', text: '猫', marks: [{ type: 'bold' }] }],
    ]);
    expect(parseBBCode('[code]\n[h1]literal[/h1]\n[list]also literal[/list]\n[/code]')).toEqual([
      { $type: `${NS}.block#code`, text: '[h1]literal[/h1]\n[list]also literal[/list]' },
    ]);
    expect(parseBBCode('[list=-2]item[/list]')[0].start).toBe(1);
  });

  it('round-trips text with facets, quotes, and code through the composer', () => {
    const hello = 'héllo ';
    const blocks: RichTextBlock[] = [
      {
        $type: `${NS}.block#text`,
        text: `${hello}world`,
        facets: [
          { index: { byteStart: 0, byteEnd: bytes(hello.trim()) }, features: [{ $type: `${NS}.facet#bold` }] },
          {
            index: { byteStart: bytes(hello), byteEnd: bytes(`${hello}world`) },
            features: [{ $type: `${NS}.facet#link`, uri: 'https://example.com' }],
          },
        ],
      },
      { $type: `${NS}.block#quote`, text: 'as they said' },
      { $type: `${NS}.block#code`, text: 'let x = 1;', lang: 'js' },
    ];
    const doc = blocksToDoc(blocks);
    expect(doc.content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }]);
    expect(parseBBCode(docToBBCode(doc))).toEqual(blocks);
  });

  it('keeps a quote\'s attribution through the editor', () => {
    const subject = { uri: 'at://did:plc:b/app.atmobb.discussion.reply/3k', cid: 'bafyq' };
    const blocks: RichTextBlock[] = [{ $type: `${NS}.block#quote`, text: 'as they said', subject }];
    const doc = blocksToDoc(blocks);
    expect(docToBBCode(doc)).toBe(`[quote=${subject.uri}|${subject.cid}]\nas they said\n[/quote]`);
    expect(parseBBCode(docToBBCode(doc))).toEqual(blocks);
  });

  it('keeps mention text but drops the facet, to be re-resolved on save', () => {
    const blocks: RichTextBlock[] = [
      {
        $type: `${NS}.block#text`,
        text: 'hi @alice.test',
        facets: [{ index: { byteStart: 3, byteEnd: 14 }, features: [{ $type: `${NS}.facet#mention`, did: 'did:plc:a' }] }],
      },
    ];
    expect(docToBBCode(blocksToDoc(blocks))).toBe('hi @alice.test');
  });

  it('carries existing images through the side-channel by CID', () => {
    const image = { $type: 'blob', ref: { $link: 'bafyimg' }, mimeType: 'image/png', size: 10 };
    const doc = blocksToDoc([{ $type: `${NS}.block#image`, image, alt: 'a cat', url: 'https://pds/blob' }]);
    expect(docToBBCode(doc)).toBe('[img=bafyimg]');
    expect(collectImages(doc)).toEqual({ bafyimg: { blob: image, alt: 'a cat' } });
  });
});
