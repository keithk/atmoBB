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
  actors?: string[];
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

// The relay's lexicon counts maxLength in UTF-8 bytes, so a limit measured in
// characters lets accented or emoji-heavy text through at two to four times
// the size and the relay refuses the whole alert. Cut on whole graphemes so an
// emoji or accented letter is never split in half.
const utf8 = new TextEncoder();
const byteLength = (s: string) => utf8.encode(s).length;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function cut(s: string, maxBytes: number, ellipsis = ''): string {
  if (byteLength(s) <= maxBytes) return s;
  const budget = maxBytes - byteLength(ellipsis);
  let out = '';
  let used = 0;
  for (const { segment } of graphemes.segment(s)) {
    const size = byteLength(segment);
    if (used + size > budget) break;
    out += segment;
    used += size;
  }
  return out + ellipsis;
}

/** `via=notify` as a query parameter, kept ahead of any fragment. */
function withMarker(url: string): string {
  const marked = new URL(url);
  marked.searchParams.set('via', 'notify');
  return marked.href;
}

export function composeNotification(input: ComposeInput): NotificationBody {
  const { kind } = input;
  const category = { category: kind, categoryDescription: CATEGORY_DESCRIPTION[kind] };
  if (input.membersOnly) {
    if (!input.openUrl) throw new Error('A members-only notification needs its open-route URL');
    return { ...MEMBERS_ONLY[kind], uri: input.openUrl, ...category };
  }
  return {
    title: cut(publicTitle(input), TITLE_MAX, '…'),
    body: cut(input.ownText, BODY_MAX),
    uri: withMarker(input.permalink),
    ...category,
    threadKey: input.threadUri,
    actors: [input.authorDid],
  };
}

/**
 * The post's own words: text and code blocks only. A quote block carries a
 * copied excerpt of whatever it quotes, which may be a members-only post.
 */
export function ownPlainText(blocks: RichTextBlock[] = []): string {
  return blocksToPlainText(blocks.filter((b) => b.$type.endsWith('#text') || b.$type.endsWith('#code')));
}
