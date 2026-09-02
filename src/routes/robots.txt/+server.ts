import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api',
    'Disallow: /login',
    'Disallow: /oauth',
    'Disallow: /register',
    'Disallow: /settings',
    '',
    `Sitemap: ${url.origin}/sitemap.xml`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
