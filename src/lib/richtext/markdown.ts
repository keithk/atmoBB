import { Lexer, type Token } from 'marked';
import type { JSONContent } from '@tiptap/core';

const text = (value: string): JSONContent[] => value ? [{ type: 'text', text: value }] : [];
const paragraph = (content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

function inline(tokens: Token[]): JSONContent[] {
  return tokens.flatMap((token): JSONContent[] => {
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
      case 'link': {
        const content = inline(token.tokens ?? []);
        const type = { strong: 'bold', em: 'italic', del: 'strike', link: 'link' }[token.type];
        const href = token.type === 'link' ? token.href : undefined;
        if (type === 'link' && !/^(https?:|mailto:)/i.test(href ?? '')) return content;
        return content.map((node) => ({ ...node, marks: [
          ...(node.marks ?? []), { type, ...(type === 'link' ? { attrs: { href } } : {}) },
        ] }));
      }
      case 'codespan':
        return text(token.text).map((node) => ({ ...node, marks: [{ type: 'code' }] }));
      case 'br': return text('\n');
      case 'text': return token.tokens ? inline(token.tokens) : text(token.text);
      case 'escape': return text(token.text);
      // HTML and remote images remain literal text, never HTML or uploaded blobs.
      default: return text(token.raw);
    }
  });
}

/** Parse into our restricted editor schema, not HTML. Unsupported structures
 * stay literal rather than silently losing content in the BBCode round trip. */
export function markdownToDoc(source: string): JSONContent {
  const content = Lexer.lex(source).flatMap((token): JSONContent[] => {
    switch (token.type) {
      case 'space': return [];
      case 'heading': return [{ type: 'heading', attrs: { level: Math.min(token.depth, 3) }, content: inline(token.tokens ?? []) }];
      case 'paragraph': return [paragraph(inline(token.tokens ?? []))];
      case 'code': return [{ type: 'codeBlock', attrs: { language: token.lang?.split(/\s/)[0] ?? null }, content: text(token.text) }];
      case 'blockquote':
        if (token.tokens?.every((t: Token) => t.type === 'paragraph' || t.type === 'space')) {
          return [{ type: 'blockquote', content: token.tokens.flatMap((t: Token) => t.type === 'paragraph' ? [paragraph(inline(t.tokens ?? []))] : []) }];
        }
        return [paragraph(text(token.raw))];
      case 'list':
        if (token.items.every((item: { task: boolean; tokens: Token[] }) => !item.task && item.tokens.length === 1 && item.tokens[0].type === 'text')) {
          return [{ type: token.ordered ? 'orderedList' : 'bulletList', attrs: { start: token.start || 1 },
            content: token.items.map((item: { tokens: Token[] }) => ({ type: 'listItem', content: [paragraph(inline(item.tokens))] })) }];
        }
        return [paragraph(text(token.raw))];
      default: return [paragraph(text(token.raw))];
    }
  });
  return { type: 'doc', content };
}
