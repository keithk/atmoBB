export const READING_STATE_VERSION = 1;
export const MAX_READING_TOPICS = 200;
export const MAX_READING_NAMESPACES = 12;

const KEY_PREFIX = 'atmobb:reading:v1:';
const REGISTRY_KEY = 'atmobb:reading:namespaces:v1';

export interface ReadingScope {
  accountDid: string;
  forumDid: string;
}

export interface TopicProgress {
  position: number;
  postHref: string;
  postAt?: string;
  touchedAt: string;
}

export interface ReadingState {
  version: typeof READING_STATE_VERSION;
  startedAt: string;
  topics: Record<string, TopicProgress>;
}

export interface TopicActivity {
  threadUri: string;
  createdAt?: string;
  lastActivity?: string;
  replyCount: number;
  canonicalHref: string;
  viewerDid?: string;
  lastPostBy?: string;
}

export type TopicReadState =
  | { status: 'new'; resumeHref: null }
  | { status: 'unread'; resumeHref: string }
  | { status: 'read'; resumeHref: null }
  | null;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface NamespaceRegistry {
  version: 1;
  namespaces: { key: string; touchedAt: string }[];
}

const validDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

const validHref = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');

function validProgress(value: unknown): value is TopicProgress {
  if (!value || typeof value !== 'object') return false;
  const progress = value as Partial<TopicProgress>;
  return Number.isInteger(progress.position) && progress.position! >= 0 &&
    validHref(progress.postHref) && validDate(progress.touchedAt) &&
    (progress.postAt === undefined || validDate(progress.postAt));
}

function parseState(raw: string | null): ReadingState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ReadingState>;
    if (value.version !== READING_STATE_VERSION || !validDate(value.startedAt) ||
      !value.topics || typeof value.topics !== 'object' || Array.isArray(value.topics)) return null;
    const topics = Object.fromEntries(
      Object.entries(value.topics).filter(([uri, progress]) => uri.startsWith('at://') && validProgress(progress)),
    );
    return { version: READING_STATE_VERSION, startedAt: value.startedAt, topics };
  } catch {
    return null;
  }
}

export function readingStorageKey(scope: ReadingScope): string {
  return `${KEY_PREFIX}${encodeURIComponent(scope.accountDid)}:${encodeURIComponent(scope.forumDid)}`;
}

export function readReadingState(storage: StorageLike, scope: ReadingScope): ReadingState | null {
  try {
    return parseState(storage.getItem(readingStorageKey(scope)));
  } catch {
    return null;
  }
}

function retainNamespaces(storage: StorageLike, key: string, now: string): void {
  let registry: NamespaceRegistry = { version: 1, namespaces: [] };
  try {
    const parsed = JSON.parse(storage.getItem(REGISTRY_KEY) ?? 'null') as Partial<NamespaceRegistry> | null;
    if (parsed?.version === 1 && Array.isArray(parsed.namespaces)) {
      registry.namespaces = parsed.namespaces.filter(
        (item): item is { key: string; touchedAt: string } =>
          !!item && typeof item.key === 'string' && item.key.startsWith(KEY_PREFIX) && validDate(item.touchedAt),
      );
    }
  } catch {
    // A malformed registry does not invalidate the independently stored namespace.
  }
  registry.namespaces = [
    { key, touchedAt: now },
    ...registry.namespaces.filter((item) => item.key !== key).sort((a, b) => b.touchedAt.localeCompare(a.touchedAt)),
  ];
  for (const stale of registry.namespaces.slice(MAX_READING_NAMESPACES)) storage.removeItem(stale.key);
  registry.namespaces = registry.namespaces.slice(0, MAX_READING_NAMESPACES);
  storage.setItem(REGISTRY_KEY, JSON.stringify(registry));
}

export function markPostVisible(
  storage: StorageLike,
  scope: ReadingScope,
  input: { threadUri: string; position: number; postHref: string; postAt?: string },
  now = new Date().toISOString(),
): ReadingState | null {
  if (!scope.accountDid || !scope.forumDid || !input.threadUri.startsWith('at://') ||
    !Number.isInteger(input.position) || input.position < 0 || !validHref(input.postHref)) return null;
  try {
    const key = readingStorageKey(scope);
    const state = parseState(storage.getItem(key)) ?? {
      version: READING_STATE_VERSION,
      startedAt: now,
      topics: {},
    };
    const previous = state.topics[input.threadUri];
    const advances = !previous || input.position > previous.position;
    const samePostWithNewerTime = previous && input.position === previous.position && validDate(input.postAt) &&
      (!previous.postAt || Date.parse(input.postAt) > Date.parse(previous.postAt));
    if (advances || samePostWithNewerTime) {
      state.topics[input.threadUri] = {
        position: input.position,
        postHref: input.postHref,
        ...(validDate(input.postAt) ? { postAt: input.postAt } : {}),
        touchedAt: now,
      };
    } else if (previous) {
      previous.touchedAt = now;
    }
    const retained = Object.entries(state.topics)
      .sort(([, a], [, b]) => b.touchedAt.localeCompare(a.touchedAt))
      .slice(0, MAX_READING_TOPICS);
    state.topics = Object.fromEntries(retained);
    storage.setItem(key, JSON.stringify(state));
    retainNamespaces(storage, key, now);
    return state;
  } catch {
    return null;
  }
}

export function topicReadState(state: ReadingState | null, activity: TopicActivity): TopicReadState {
  if (!state) return null;
  // Posting is itself proof that the viewer has reached the latest activity.
  // This also keeps a newly created topic from immediately appearing unread
  // while its thread page and local reading marker are still settling.
  if (activity.viewerDid && activity.lastPostBy === activity.viewerDid) {
    return { status: 'read', resumeHref: null };
  }
  const progress = state.topics[activity.threadUri];
  if (!progress) {
    return validDate(activity.createdAt) && Date.parse(activity.createdAt) > Date.parse(state.startedAt)
      ? { status: 'new', resumeHref: null }
      : null;
  }
  const laterByCount = Number.isInteger(activity.replyCount) && activity.replyCount > progress.position;
  const laterByTime = validDate(activity.lastActivity) && validDate(progress.postAt) &&
    Date.parse(activity.lastActivity) > Date.parse(progress.postAt);
  if (laterByCount || laterByTime) {
    return { status: 'unread', resumeHref: validHref(progress.postHref) ? progress.postHref : activity.canonicalHref };
  }
  return { status: 'read', resumeHref: null };
}

export const readingStateEvent = (scope: ReadingScope) => `atm-reading:${readingStorageKey(scope)}`;
