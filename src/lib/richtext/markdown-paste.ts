import type { Editor } from '@tiptap/core';
import { markdownToDoc } from './markdown';

function isRawTextWrapper(html: string, text: string): boolean {
  // Browsers can copy a text/plain page as a single <pre> plus metadata.
  // Do not reinterpret real code (<pre><code>), styled content, or editor slices.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelector('[data-pm-slice]')) return false;
  const elements = [...doc.body.children].filter((element) => element.tagName !== 'META');
  const pre = elements[0];
  if (elements.length !== 1 || pre.tagName !== 'PRE' || pre.children.length) return false;
  if (pre.className || pre.hasAttribute('data-language')) return false;
  const { fontWeight, fontStyle, textDecoration, textDecorationLine } = (pre as HTMLElement).style;
  if (/bold/.test(fontWeight) || Number(fontWeight) >= 600
    || /italic|oblique/.test(fontStyle)
    || /underline|overline|line-through/.test(`${textDecoration} ${textDecorationLine}`)) return false;
  const normalize = (value: string) => value.replace(/\r\n?/g, '\n').trim();
  return normalize(pre.textContent ?? '') === normalize(text)
    && normalize(doc.body.textContent ?? '') === normalize(text);
}

/** Return false to leave rich HTML and literal code pastes to the editor. */
export function pasteMarkdown(editor: Editor, clipboard: Pick<DataTransfer, 'getData'> | null): boolean {
  if (editor.isActive('codeBlock') || editor.isActive('code')) return false;
  const text = clipboard?.getData('text/plain');
  if (!text) return false;
  const html = clipboard?.getData('text/html');
  if (html && !isRawTextWrapper(html, text)) return false;
  return editor.commands.insertContent(markdownToDoc(text).content ?? []);
}
