import { parseAtUri } from './appview-paths';

export const HOMEPAGE_LAYOUTS = ['boards', 'latest', 'categories-latest'] as const;
export const HOMEPAGE_WELCOME_STYLES = ['classic', 'compact', 'hidden'] as const;

export type HomepageLayout = (typeof HOMEPAGE_LAYOUTS)[number];
export type HomepageWelcome = (typeof HOMEPAGE_WELCOME_STYLES)[number];

export interface HomepageSettings {
  layout: HomepageLayout;
  sidebar: boolean;
  welcome: HomepageWelcome;
  featuredThreads: string[];
}

export const DEFAULT_HOMEPAGE: HomepageSettings = {
  layout: 'boards',
  sidebar: false,
  welcome: 'classic',
  featuredThreads: [],
};

const isOneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === 'string' && choices.includes(value as T);

export function isThreadUri(value: string): boolean {
  return parseAtUri(value)?.collection === 'app.atmobb.discussion.thread';
}

/** Normalize indexed records at the read boundary so old and malformed records stay safe. */
export function normalizeHomepage(value: unknown): HomepageSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_HOMEPAGE };
  const homepage = value as Record<string, unknown>;
  const featuredThreads = Array.isArray(homepage.featuredThreads)
    ? homepage.featuredThreads
        .filter((uri): uri is string => typeof uri === 'string' && isThreadUri(uri))
        .slice(0, 3)
    : [];

  return {
    layout: isOneOf(homepage.layout, HOMEPAGE_LAYOUTS) ? homepage.layout : 'boards',
    sidebar: homepage.sidebar === true,
    welcome: isOneOf(homepage.welcome, HOMEPAGE_WELCOME_STYLES) ? homepage.welcome : 'classic',
    featuredThreads,
  };
}

/** Keep the profile record backwards-compatible and omit the all-classic default. */
export function homepageRecord(settings: HomepageSettings): HomepageSettings | undefined {
  return settings.layout === DEFAULT_HOMEPAGE.layout &&
    settings.sidebar === DEFAULT_HOMEPAGE.sidebar &&
    settings.welcome === DEFAULT_HOMEPAGE.welcome &&
    settings.featuredThreads.length === 0
    ? undefined
    : settings;
}

export function selectFeaturedThreads<T extends { uri: string }>(
  threads: T[],
  configuredUris: string[],
): T[] {
  const byUri = new Map(threads.map((thread) => [thread.uri, thread]));
  return configuredUris.flatMap((uri) => {
    const thread = byUri.get(uri);
    return thread ? [thread] : [];
  });
}

export function rankHotThreads<T extends { replyCount: number; lastActivity: string }>(threads: T[]): T[] {
  return threads
    .filter((thread) => thread.replyCount > 0)
    .toSorted((a, b) => b.replyCount - a.replyCount || b.lastActivity.localeCompare(a.lastActivity));
}
