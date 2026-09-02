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

interface ThreadValue {
  board: string;
  title: string;
  body?: RichTextBlock[];
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
): Promise<BoardThreads> {
  const { threads, replies } = await gatherSpace(viewer, space);
  const agg = replyAggregates(replies);
  const profiles = await profilesFor([...threads.map((t) => t.author), ...replies.map((r) => r.author)]);

  const rows = threads
    .map((t) => {
      const a = agg.get(t.uri);
      const created = t.value.createdAt ?? '';
      return {
        uri: t.uri,
        cid: t.cid,
        board: t.value.board,
        author: t.author,
        authorProfile: profiles[t.author],
        title: t.value.title,
        createdAt: created,
        replyCount: a?.count ?? 0,
        lastActivity: a && a.last > created ? a.last : created,
        lastReplyBy: a?.lastBy,
        // Moderation flags are kept in the public index, which never sees
        // space records, so a private board has none to apply.
        locked: false,
        pinned: false,
      };
    })
    .sort((x, y) => (x.lastActivity < y.lastActivity ? 1 : -1));

  return {
    board: boardMeta ? { ...boardMeta, threadCount: threads.length, replyCount: replies.length } : boardMeta,
    threads: rows,
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
