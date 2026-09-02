export interface PageMetadata {
  /** Page-specific title. The forum name is appended when the document title is rendered. */
  title?: string;
  /** Search-result and social-card summary. Defaults to the forum description. */
  description?: string;
  /** Absolute or root-relative URL of the 1200×630 social card. */
  image?: string;
  /** Text alternative for the social card. */
  imageAlt?: string;
  /** Open Graph object type. */
  type?: 'website' | 'article' | 'profile';
  /** Keep authenticated, private, transient, and error pages out of search results. */
  noindex?: boolean;
  /** Override the clean, self-referencing canonical URL. */
  canonical?: string;
  /** Article timestamps, when the page represents a public thread. */
  publishedTime?: string;
  modifiedTime?: string;
  authorUrl?: string;
  /** Canonical handle for an Open Graph profile page. */
  profileUsername?: string;
  /** Schema.org properties merged into this page's WebPage entity. */
  structuredData?: Record<string, unknown>;
}

export interface ResolvedMetadata extends Required<Pick<PageMetadata, 'title' | 'description' | 'image' | 'imageAlt' | 'type' | 'noindex'>> {
  documentTitle: string;
  canonical: string;
  robots: string;
  publishedTime?: string;
  modifiedTime?: string;
  authorUrl?: string;
  profileUsername?: string;
  structuredData?: Record<string, unknown>;
}

const PAGE_TITLES: Record<string, string> = {
  '/latest': 'Latest',
  '/members': 'Members',
  '/rules': 'Rules',
  '/host': 'Host a forum',
  '/login': 'Log in',
  '/register': 'Register',
  '/settings/avatar': 'Avatar builder',
  '/settings/profile': 'Edit profile',
  '/admin': 'Admin',
  '/admin/appearance': 'Appearance — Admin',
  '/admin/boards': 'Boards — Admin',
  '/admin/connect': 'Connection — Admin',
  '/admin/hosting': 'Hosting — Admin',
  '/admin/staff': 'Staff — Admin',
  '/admin/topics': 'Topics — Admin',
};

const isPrivateRoute = (routeId: string) =>
  routeId.startsWith('/admin') ||
  routeId.startsWith('/login') ||
  routeId.startsWith('/oauth') ||
  routeId.startsWith('/register') ||
  routeId.startsWith('/settings');

function routeDefaults(routeId: string | null, siteName: string): PageMetadata {
  if (!routeId) return { title: 'Page not found', description: `This page could not be found on ${siteName}.`, noindex: true };
  if (routeId === '/') return { title: siteName, noindex: false };

  const title = PAGE_TITLES[routeId];
  if (routeId === '/latest') {
    return { title, description: `The latest conversations and activity on ${siteName}.`, noindex: false };
  }
  if (routeId === '/members') {
    return { title, description: `Meet the members of ${siteName}.`, noindex: false };
  }
  if (routeId === '/rules') {
    return { title, description: `Community rules for ${siteName}.`, noindex: false };
  }
  if (routeId === '/host') {
    return { title, description: 'Create an independent forum on the atmosphere.', noindex: false };
  }
  if (isPrivateRoute(routeId)) return { title: title ?? 'Settings', noindex: true };

  // Public dynamic routes opt in from their server load once real, shareable
  // content has been found. Until then, transient and error states stay out.
  return { title: title ?? 'Page', noindex: true };
}

function concise(value: string | undefined, fallback: string, max = 200): string {
  const clean = (value?.trim() || fallback).replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max - 1);
  const wordBoundary = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, wordBoundary > max * 0.7 ? wordBoundary : clipped.length).trimEnd()}…`;
}

function absoluteUrl(value: string, origin: string): string {
  return new URL(value, origin).href;
}

function canonicalUrl(url: URL, override?: string): string {
  if (override) return absoluteUrl(override, url.origin);
  const canonical = new URL(url.pathname, url.origin);
  // Cursor pages contain distinct lists. Everything else in the query string
  // is UI state (replying, editing, save notices, social-card previews, etc.).
  const cursor = url.searchParams.get('cursor');
  if (cursor) canonical.searchParams.set('cursor', cursor);
  return canonical.href;
}

export function resolveMetadata({
  routeId,
  url,
  status,
  siteName,
  siteDescription,
  page,
}: {
  routeId: string | null;
  url: URL;
  status?: number;
  siteName: string;
  siteDescription?: string;
  page?: PageMetadata;
}): ResolvedMetadata {
  const defaults = routeDefaults(routeId, siteName);
  const title = page?.title ?? defaults.title ?? siteName;
  const description = concise(
    page?.description ?? defaults.description,
    siteDescription?.trim() || 'An independent forum on the atmosphere.',
  );
  const image = absoluteUrl(page?.image ?? '/og/generic.png', url.origin);
  const noindex = (status ?? 200) >= 400 || (page?.noindex ?? defaults.noindex ?? true);

  return {
    title,
    documentTitle: title === siteName ? siteName : `${title} — ${siteName}`,
    description,
    image,
    imageAlt: page?.imageAlt?.trim() || `${title} on ${siteName}`,
    type: page?.type ?? 'website',
    noindex,
    canonical: canonicalUrl(url, page?.canonical),
    robots: noindex
      ? 'noindex, nofollow'
      : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    publishedTime: page?.publishedTime,
    modifiedTime: page?.modifiedTime,
    authorUrl: page?.authorUrl,
    profileUsername: page?.profileUsername,
    structuredData: page?.structuredData,
  };
}

export function serializeStructuredData(meta: ResolvedMetadata, siteName: string, siteDescription: string | undefined): string {
  const origin = new URL(meta.canonical).origin;
  const websiteId = `${origin}/#website`;
  const pageId = `${meta.canonical}#webpage`;
  const website = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: `${origin}/`,
    name: siteName,
    description: concise(siteDescription, 'An independent forum on the atmosphere.'),
  };
  const webPage = {
    '@type': 'WebPage',
    '@id': pageId,
    url: meta.canonical,
    name: meta.documentTitle,
    description: meta.description,
    isPartOf: { '@id': websiteId },
    primaryImageOfPage: { '@type': 'ImageObject', url: meta.image },
  };
  const isPosting = meta.structuredData?.['@type'] === 'DiscussionForumPosting';
  const graph = isPosting
    ? [
        website,
        { ...webPage, mainEntity: { '@id': `${meta.canonical}#discussion` } },
        {
          ...meta.structuredData,
          '@id': `${meta.canonical}#discussion`,
          url: meta.canonical,
          mainEntityOfPage: { '@id': pageId },
        },
      ]
    : [website, { ...webPage, ...meta.structuredData }];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
