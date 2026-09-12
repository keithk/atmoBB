import type { RichTextBlock } from '$lib/richtext/bbcode';
import { postAuthor } from '$lib/appview-paths';

// Who a freshly written post notifies, and why (KTD6). Pure: the record the
// app just wrote plus whatever the caller could confirm about the thread.

export type RecipientKind = 'mention' | 'post-reply' | 'thread-reply' | 'board-watch';

export interface Recipient {
  did: string;
  kind: RecipientKind;
}

/** The thread or reply record as written; `thread` and `parent` are reply-only. */
export interface PostRecord {
  body?: RichTextBlock[];
  thread?: { uri: string; cid: string };
  parent?: { uri: string; cid: string };
}

export interface RecipientInput {
  record: PostRecord;
  threadUri: string;
  authorDid: string;
  forumDid: string;
  /** Watcher DIDs of the board, for a new thread only. */
  watchers?: string[];
  /**
   * URIs of the posts known to be in this thread. A reply URI, public or
   * space-shaped, never names its thread, so a parent or quote subject counts
   * as a post-reply only when it is the thread itself or in this set. Without
   * the set, every parent and subject is ignored rather than trusted.
   */
  threadPostUris?: Set<string> | string[];
  /** Leave the starter out when the caller could not confirm the thread. */
  skipThreadStarter?: boolean;
}

const MENTION = '#mention';
const QUOTE = '#quote';

function mentionedDids(blocks: RichTextBlock[] = []): string[] {
  return blocks.flatMap((b) =>
    (b.facets ?? []).flatMap((f) => f.features.flatMap((feat) => (feat.$type.endsWith(MENTION) && feat.did ? [feat.did] : []))),
  );
}

export function resolveRecipients({
  record,
  threadUri,
  authorDid,
  forumDid,
  watchers = [],
  threadPostUris,
  skipThreadStarter = false,
}: RecipientInput): Recipient[] {
  const known = new Set(threadPostUris ?? []);
  const inThread = (uri: string) => uri === threadUri || known.has(uri);

  const targets = [
    ...(record.parent ? [record.parent.uri] : []),
    ...(record.body ?? []).flatMap((b) => (b.$type.endsWith(QUOTE) && b.subject ? [b.subject.uri] : [])),
  ].filter(inThread);

  // Most specific kind first; the first kind seen for a DID wins.
  const ordered: [RecipientKind, string[]][] = [
    ['mention', mentionedDids(record.body)],
    ['post-reply', targets.map(postAuthor)],
    ['thread-reply', skipThreadStarter ? [] : [postAuthor(threadUri)]],
    ['board-watch', watchers],
  ];
  const out: Recipient[] = [];
  const seen = new Set([authorDid, forumDid]);
  for (const [kind, dids] of ordered) {
    for (const did of dids) {
      if (seen.has(did)) continue;
      seen.add(did);
      out.push({ did, kind });
    }
  }
  return out;
}
