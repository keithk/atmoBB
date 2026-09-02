import { describe, expect, it } from 'vitest';
import { resolveMetadata, serializeStructuredData } from './seo';

const resolve = (routeId: string | null, href: string, page = {}, status = 200) =>
  resolveMetadata({
    routeId,
    url: new URL(href),
    status,
    siteName: 'Test Forum',
    siteDescription: 'A place to test.',
    page,
  });

describe('resolveMetadata', () => {
  it('uses forum defaults on the homepage', () => {
    const meta = resolve('/', 'https://forum.example/');
    expect(meta.documentTitle).toBe('Test Forum');
    expect(meta.description).toBe('A place to test.');
    expect(meta.image).toBe('https://forum.example/og/generic.png');
    expect(meta.noindex).toBe(false);
  });

  it('gives public sections distinct metadata', () => {
    const meta = resolve('/latest', 'https://forum.example/latest');
    expect(meta.documentTitle).toBe('Latest — Test Forum');
    expect(meta.description).toContain('latest conversations');
    expect(meta.robots).toContain('max-image-preview:large');
  });

  it('keeps private and account pages out of search results', () => {
    expect(resolve('/settings/profile', 'https://forum.example/settings/profile').robots).toBe('noindex, nofollow');
    expect(resolve('/admin/boards', 'https://forum.example/admin/boards').noindex).toBe(true);
    expect(resolve(null, 'https://forum.example/missing').documentTitle).toBe('Page not found — Test Forum');
    expect(resolve('/host', 'https://forum.example/host', {}, 404).noindex).toBe(true);
  });

  it('removes transient query state but preserves pagination in canonicals', () => {
    expect(resolve('/t/[did]/[rkey]', 'https://forum.example/t/did:plc:a/one?edit=two#post').canonical)
      .toBe('https://forum.example/t/did:plc:a/one');
    expect(resolve('/latest', 'https://forum.example/latest?cursor=25&saved=1').canonical)
      .toBe('https://forum.example/latest?cursor=25');
  });

  it('lets resolved public content opt into indexing and structured data', () => {
    const meta = resolve('/t/[did]/[rkey]', 'https://forum.example/t/did:plc:a/one', {
      title: 'A thread',
      description: 'The opening post.',
      image: '/t/did:plc:a/one/og.png',
      noindex: false,
      structuredData: { '@type': 'DiscussionForumPosting', headline: 'A thread' },
    });
    expect(meta.image).toBe('https://forum.example/t/did:plc:a/one/og.png');
    expect(meta.noindex).toBe(false);
    expect(serializeStructuredData(meta, 'Test Forum', 'A place to test.')).toContain('DiscussionForumPosting');
  });
});
