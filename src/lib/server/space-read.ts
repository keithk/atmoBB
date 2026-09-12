import {
  listSpaceRepos,
  listSpaceRecords,
  getSpaceRecord,
  THREAD_NSID,
  REPLY_NSID,
  parseSpaceUri,
  type BoardThreads,
  type ThreadPage,
  type ActorProfile,
  type RichTextBlock,
} from './appview';
import { getPublicProfile } from './profiles';
import type { ThreadFilters } from '$lib/thread-filters';

interface ThreadValue {
  board: string;
  title: string;
  body?: RichTextBlock[];
  tags?: string[];
  createdAt?: string;
  editedAt?: string;
}
interface ReplyValue {
  thread: { uri: string; cid?: string };
  parent?: { uri: string; cid: string };
  body?: RichTextBlock[];
  createdAt?: string;
  editedAt?: string;
}
interface Gathered<V> {
  uri: string;
  cid: string;
  author: string;
  value: V;
}

/** Public actor.profile records from their authors' PDSes; absent → undefined. */
async function profilesFor(dids: string[]): Promise<Record<string, ActorProfile | undefined>> {
  const unique = [...new Set(dids)];
  const entries = await Promise.all(
    unique.map(
      async (did) =>
        [did, (await getPublicProfile(did)) ?? undefined] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/** Every thread and reply record in a space, read as `viewer` (must be a member). */
async function gatherSpace(
  viewer: string,
  space: string,
): Promise<{ threads: Gathered<ThreadValue>[]; replies: Gathered<ReplyValue>[] }> {
  const authors = await listSpaceRepos(viewer, space);
  const threads: Gathered<ThreadValue>[] = [];
  const replies: Gathered<ReplyValue>[] = [];

  async function pull<V>(
    author: string,
    collection: string,
    into: Gathered<V>[],
  ): Promise<void> {
    const refs = await listSpaceRecords(viewer, space, author, collection);
    await Promise.all(
      refs.map(async (ref) => {
        try {
          const rec = await getSpaceRecord<V>(viewer, space, author, collection, ref.rkey);
          into.push({ uri: rec.uri, cid: rec.cid, author, value: rec.value });
        } catch {
          /* a record vanished between list and get — skip it */
        }
      }),
    );
  }

  await Promise.all(
    authors.flatMap((author) => [pull(author, THREAD_NSID, threads), pull(author, REPLY_NSID, replies)]),
  );
  return { threads, replies };
}

/** Reply aggregates per thread URI: count, last activity, last replier. */
function replyAggregates(replies: Gathered<ReplyValue>[]) {
  const by = new Map<string, { count: number; last: string; lastBy: string }>();
  for (const r of replies) {
    const tu = r.value.thread?.uri;
    if (!tu) continue;
    const at = r.value.createdAt ?? '';
    const cur = by.get(tu);
    if (!cur) by.set(tu, { count: 1, last: at, lastBy: r.author });
    else {
      cur.count++;
      if (at > cur.last) {
        cur.last = at;
        cur.lastBy = r.author;
      }
    }
  }
  return by;
}

/** BoardThreads for a space-backed board, read as the viewing member. */
export async function readSpaceBoardThreads(
  viewer: string,
  space: string,
  boardMeta: BoardThreads['board'],
  options: ThreadFilters & { offset?: number; limit?: number } = {},
): Promise<BoardThreads> {
  const { threads, replies } = await gatherSpace(viewer, space);
  const agg = replyAggregates(replies);
  const filtered = threads.filter((t) => {
    if (options.q && !t.value.title.toLowerCase().includes(options.q.toLowerCase())) return false;
    if (options.tag && !(t.value.tags ?? []).some((tag) => tag.toLowerCase() === options.tag)) return false;
    return true;
  });
  const offset = options.offset ?? 0;
  // Homepage callers aggregate the entire board; only list routes opt into paging.
  const limit = options.limit ?? filtered.length;
  const visible = filtered
    .map((t) => {
      const a = agg.get(t.uri);
      const created = t.value.createdAt ?? '';
      return { t, a, created, lastActivity: a && a.last > created ? a.last : created };
    })
    .sort((x, y) => y.lastActivity.localeCompare(x.lastActivity) || x.t.uri.localeCompare(y.t.uri))
    .slice(offset, offset + limit);
  // Preserve the existing one-profile-per-visible-author behavior. Reply
  // participant chips use Avatar's DID fallback rather than adding a second
  // wave of per-participant PDS requests (the space API has no batch profile read).
  const profiles = await profilesFor(visible.map(({ t }) => t.author));

  const rows = visible.map(({ t, a, created, lastActivity }) => ({
        uri: t.uri,
        cid: t.cid,
        board: t.value.board,
        author: t.author,
        authorProfile: profiles[t.author],
        title: t.value.title,
        tags: t.value.tags,
        createdAt: created,
        replyCount: a?.count ?? 0,
        lastActivity,
        lastReplyBy: a?.lastBy,
        participants: [
          t.author,
          ...replies
            .filter((r) => r.value.thread?.uri === t.uri)
            .sort((x, y) => (y.value.createdAt ?? '').localeCompare(x.value.createdAt ?? '') || x.author.localeCompare(y.author))
            .map((r) => r.author),
        ]
          .filter((did, index, all) => all.indexOf(did) === index)
          .slice(0, 5)
          .map((did) => ({ did, profile: profiles[did] })),
        // Moderation flags are kept in the public index, which never sees
        // space records, so a private board has none to apply.
        locked: false,
        pinned: false,
      }));

  return {
    board: boardMeta ? { ...boardMeta, threadCount: threads.length, replyCount: replies.length } : boardMeta,
    threads: rows,
    filteredCount: filtered.length,
    ...(offset + rows.length < filtered.length ? { cursor: String(offset + rows.length) } : {}),
  };
}

/** ThreadPage for a thread that lives in a space, read as the viewing member. */
export async function readSpaceThreadPage(viewer: string, threadUri: string): Promise<ThreadPage> {
  const p = parseSpaceUri(threadUri);
  if (!p) return { replies: [], replyCount: 0 };

  let head: Gathered<ThreadValue>;
  try {
    const rec = await getSpaceRecord<ThreadValue>(viewer, p.space, p.author, THREAD_NSID, p.rkey);
    head = { uri: rec.uri, cid: rec.cid, author: p.author, value: rec.value };
  } catch {
    return { replies: [], replyCount: 0 };
  }

  const { threads, replies } = await gatherSpace(viewer, p.space);
  // Per-author standing within this board (threads + replies), our stand-in for
  // the public post count, which never sees space records.
  const posts = new Map<string, number>();
  for (const rec of [...threads, ...replies]) posts.set(rec.author, (posts.get(rec.author) ?? 0) + 1);

  const mine = replies
    .filter((r) => r.value.thread?.uri === threadUri)
    .sort((a, b) => ((a.value.createdAt ?? '') < (b.value.createdAt ?? '') ? -1 : 1));

  const profiles = await profilesFor([head.author, ...mine.map((r) => r.author)]);

  return {
    thread: {
      uri: head.uri,
      cid: head.cid,
      author: head.author,
      authorProfile: profiles[head.author],
      authorPosts: posts.get(head.author) ?? 0,
      value: {
        title: head.value.title,
        body: head.value.body,
        tags: head.value.tags,
        board: head.value.board,
        createdAt: head.value.createdAt,
        editedAt: head.value.editedAt,
      },
      hidden: false,
      locked: false,
      pinned: false,
    },
    replies: mine.map((r) => ({
      uri: r.uri,
      cid: r.cid,
      author: r.author,
      authorProfile: profiles[r.author],
      authorPosts: posts.get(r.author) ?? 0,
      value: { body: r.value.body, createdAt: r.value.createdAt, editedAt: r.value.editedAt, parent: r.value.parent },
      indexedAt: r.value.createdAt ?? '',
    })),
    replyCount: mine.length,
  };
}
