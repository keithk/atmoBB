import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PostContent from './PostContent.svelte';

describe('post preview server rendering', () => {
  it('keeps all long-post content available before JavaScript runs', () => {
    const body = Array.from({ length: 20 }, (_, index) => ({
      $type: 'app.atmobb.richtext.block#text',
      text: `Paragraph ${index + 1}`,
    }));
    const { body: html } = render(PostContent, { props: { postUri: 'at://author/post/one', body } });
    for (const block of body) expect(html).toContain(block.text);
    expect(html).not.toContain('atm-post-content--collapsed');
    expect(html).not.toContain('Read full post');
  });

  it('renders empty and short bodies without an expand control', () => {
    for (const body of [[], [{ $type: 'app.atmobb.richtext.block#text', text: 'Short reply' }]]) {
      const { body: html } = render(PostContent, { props: { postUri: 'at://author/post/one', body } });
      expect(html).not.toContain('<button');
      expect(html).not.toContain('atm-post-content--collapsed');
    }
  });
});
