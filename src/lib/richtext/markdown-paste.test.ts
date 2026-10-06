// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { pasteMarkdown } from './markdown-paste';
import { docToBBCode } from './tiptap-bbcode';
import { parseBBCode } from './bbcode';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function editorWith(content = '<p></p>') {
  const editor = new Editor({ extensions: [StarterKit], content });
  editors.push(editor);
  editor.commands.setTextSelection(1);
  return editor;
}

const source = '# Migration\n\nMove to [atmoBB](https://atmobb.app/).\n\n## Authors\n\nKeep paragraphs.';
const clipboard = (html = '', text = source) => ({
  getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '',
});

describe('Markdown clipboard paste', () => {
  it.each([
    '',
    `<meta charset="utf-8"><pre style="white-space: pre-wrap;">${source}</pre>`,
    `<pre style="white-space: pre-wrap; font-weight: 400; font-style: normal; text-decoration: none; font-family: monospace;">${source}</pre>`,
    `<html><body><!--StartFragment--><pre>${source}</pre><!--EndFragment--></body></html>`,
  ])('converts plain text and raw browser text wrappers into saved blocks and facets (%s)', (html) => {
    const editor = editorWith();
    expect(pasteMarkdown(editor, clipboard(html))).toBe(true);
    expect(parseBBCode(docToBBCode(editor.getJSON()))).toEqual([
      { $type: 'app.atmobb.richtext.block#text', text: 'Migration', heading: 1 },
      {
        $type: 'app.atmobb.richtext.block#text',
        text: 'Move to atmoBB.',
        facets: [{
          index: { byteStart: 8, byteEnd: 14 },
          features: [{ $type: 'app.atmobb.richtext.facet#link', uri: 'https://atmobb.app/' }],
        }],
      },
      { $type: 'app.atmobb.richtext.block#text', text: 'Authors', heading: 2 },
      { $type: 'app.atmobb.richtext.block#text', text: 'Keep paragraphs.' },
    ]);
  });

  it.each([
    '<h1>Migration</h1><p>Formatted content</p>',
    `<pre><code>${source}</code></pre>`,
    `<pre><b>${source}</b></pre>`,
    `<pre style="font-weight: bold">${source}</pre>`,
    `<pre style="font-weight: 700">${source}</pre>`,
    `<pre style="font-style: italic">${source}</pre>`,
    `<pre style="text-decoration: underline">${source}</pre>`,
    `<pre style="text-decoration-line: line-through">${source}</pre>`,
    `<pre class="language-markdown">${source}</pre>`,
    `<pre data-language="markdown">${source}</pre>`,
    `<pre data-pm-slice="0 0 []">${source}</pre>`,
    `<p>Other content</p><pre>${source}</pre>`,
    '<pre>Different clipboard content</pre>',
  ])('leaves rich HTML, code, internal copies, and mismatched content alone (%s)', (html) => {
    const editor = editorWith();
    const before = editor.getJSON();
    expect(pasteMarkdown(editor, clipboard(html))).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it.each(['<pre><code>literal</code></pre>', '<p><code>literal</code></p>'])(
    'does not parse Markdown inside code (%s)', (content) => {
      const editor = editorWith(content);
      expect(pasteMarkdown(editor, clipboard())).toBe(false);
    },
  );

  it('ignores absent and empty clipboard data', () => {
    const editor = editorWith();
    expect(pasteMarkdown(editor, null)).toBe(false);
    expect(pasteMarkdown(editor, clipboard('', ''))).toBe(false);
  });
});
