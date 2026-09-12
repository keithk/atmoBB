import type { RichTextBlock } from '$lib/richtext/bbcode';
import { blocksToPlainText } from '$lib/richtext/plain';
import type { RecipientKind } from './recipients';

// The relay send body for one recipient (KTD8). Public boards get the
// author, the thread title and an excerpt; members-only boards get fixed
// strings and a link through the forum's own open route, so nothing in the
// payload can name a member, a thread, or a board.

const TITLE_MAX = 100;
const BODY_MAX = 500;

export interface ComposeInput {
  kind: RecipientKind;
  authorHandle: string;
  authorDid: string;
  threadTitle: string;
  boardName: string;
  threadUri: string;
  /** The post's own words, from ownPlainText. */
  ownText: string;
  /** Absolute link to the post; may end in a #post- fragment. */
  permalink: string;
  membersOnly: boolean;
  /** Members-only: the open-route URL, already carrying ?via=notify. */
  openUrl?: string;
}

export interface NotificationBody {
  title: string;
  body: string;
  uri: string;
  category: RecipientKind;
  categoryDescription: string;
  threadKey?: string;
  actors?: { did: string; handle: string }[];
}

const CATEGORY_DESCRIPTION: Record<RecipientKind, string> = {
  'thread-reply': 'Replies in threads you started',
  'post-reply': 'Replies to and quotes of your posts',
  mention: 'Posts that mention you',
  'board-watch': 'New threads in boards you watch',
};

const MEMBERS_ONLY: Record<RecipientKind, { title: string; body: string }> = {
  'thread-reply': {
    title: 'New reply in your thread on a members-only board',
    body: 'Someone replied in a thread you started on a members-only board.',
  },
  'post-reply': {
    title: 'New reply to your post on a members-only board',
    body: 'Someone replied to one of your posts on a members-only board.',
  },
  mention: {
    title: 'You were mentioned on a members-only board',
    body: 'Someone mentioned you in a post on a members-only board.',
  },
  'board-watch': {
    title: 'New thread on a members-only board you watch',
    body: 'Someone started a thread in a members-only board you watch.',
  },
};

function publicTitle({ kind, authorHandle, threadTitle, boardName }: ComposeInput): string {
  switch (kind) {
    case 'thread-reply':
      return `${authorHandle} replied in "${threadTitle}"`;
    case 'post-reply':
      return `${authorHandle} replied to your post in "${threadTitle}"`;
    case 'mention':
      return `${authorHandle} mentioned you in "${threadTitle}"`;
    case 'board-watch':
      return `${authorHandle} started "${threadTitle}" in ${boardName}`;
  }
}

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** `via=notify` as a query parameter, kept ahead of any fragment. */
function withMarker(url: string): string {
  const [base, fragment] = url.split('#', 2);
  const marked = `${base}${base.includes('?') ? '&' : '?'}via=notify`;
  return fragment === undefined ? marked : `${marked}#${fragment}`;
}

export function composeNotification(input: ComposeInput): NotificationBody {
  const { kind } = input;
  const category = { category: kind, categoryDescription: CATEGORY_DESCRIPTION[kind] };
  if (input.membersOnly) {
    if (!input.openUrl) throw new Error('A members-only notification needs its open-route URL');
    return { ...MEMBERS_ONLY[kind], uri: input.openUrl, ...category };
  }
  return {
    title: cut(publicTitle(input), TITLE_MAX),
    body: input.ownText.slice(0, BODY_MAX),
    uri: withMarker(input.permalink),
    ...category,
    threadKey: input.threadUri,
    actors: [{ did: input.authorDid, handle: input.authorHandle }],
  };
}

/**
 * The post's own words: text and code blocks only. A quote block carries a
 * copied excerpt of whatever it quotes, which may be a members-only post.
 */
export function ownPlainText(blocks: RichTextBlock[] = []): string {
  return blocksToPlainText(blocks.filter((b) => b.$type.endsWith('#text') || b.$type.endsWith('#code')));
}
