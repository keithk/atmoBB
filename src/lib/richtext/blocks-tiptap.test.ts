import { describe, expect, it } from 'vitest';
import { blocksToDoc } from './blocks-tiptap';
import { collectImages, docToBBCode } from './tiptap-bbcode';
import { parseBBCode, type RichTextBlock } from './bbcode';

const NS = 'app.atmobb.richtext';
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('blocksToDoc', () => {
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
