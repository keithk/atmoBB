import type { RequestHandler } from './$types';
import { boardPath, threadPath } from '$lib/appview-paths';
import { FORUM_DID, getBoardIndex, getLatestThreads, spaceOfBoard } from '$lib/server/appview';
import { hostingEnabled } from '$lib/server/hosting';

interface SitemapEntry {
  path: string;
  lastmod?: string;
}

const xml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const GET: RequestHandler = async ({ url }) => {
  const entries: SitemapEntry[] = [
    { path: '/' },
    { path: '/latest' },
    { path: '/members' },
    { path: '/rules' },
    ...(hostingEnabled() ? [{ path: '/host' }] : []),
  ];

  try {
    const [index, latest] = await Promise.all([
      getBoardIndex(FORUM_DID()),
      getLatestThreads(undefined, 50),
    ]);
    entries.push(
      ...index.boards
        .filter((board) => !spaceOfBoard(board.value.access))
        .map((board) => ({ path: boardPath(board.uri, FORUM_DID()), lastmod: board.latestActivity })),
      ...latest.threads.map((thread) => ({ path: threadPath(thread.uri), lastmod: thread.lastActivity })),
    );
  } catch {
    // Core pages still make a valid sitemap while the appview is unavailable.
  }

  const unique = new Map(entries.map((entry) => [entry.path, entry]));
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...[...unique.values()].map((entry) => {
      const location = xml(new URL(entry.path, url.origin).href);
      const lastmod = entry.lastmod ? `<lastmod>${xml(entry.lastmod)}</lastmod>` : '';
      return `<url><loc>${location}</loc>${lastmod}</url>`;
    }),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
    },
  });
};
