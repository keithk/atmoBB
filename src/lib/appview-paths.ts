export function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  return m ? { did: m[1], collection: m[2], rkey: m[3] } : null;
}

export const pathSlug = (value: string, fallback: string) =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{Mark}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || fallback;

export const threadPath = (uri: string, boardName?: string, title?: string) => {
  // Space thread: at://<forum>/space/<type>/<boardRkey>/<author>/<collection>/<rkey>.
  // These live under their private board at /b/<forum>/<boardRkey>/t/<author>/<rkey>.
  const parts = uri.split('/');
  if (parts[3] === 'space' && parts.length >= 9) {
    return `/b/${parts[2]}/${parts[5]}/t/${parts[6]}/${parts[8]}`;
  }
  const p = parseAtUri(uri);
  if (!p) return '/';
  if (!boardName || !title) return `/t/${p.did}/${p.rkey}`;
  const board = encodeURIComponent(pathSlug(boardName, 'board'));
  const thread = encodeURIComponent(pathSlug(title, 'thread'));
  return `/t/${board}/${thread}/${p.did}/${p.rkey}`;
};

export const boardPath = (uri: string, localDid: string) => {
  const p = parseAtUri(uri);
  if (!p) return '/';
  // Boards on other accounts (mounted atmosphere boards) carry their DID in
  // the path; the forum's own boards stay short.
  return p.did === localDid ? `/b/${p.rkey}` : `/b/${p.did}/${p.rkey}`;
};

/** Replies per thread page. Shared by the thread page and reply permalinks. */
export const THREAD_PAGE_SIZE = 25;

/**
 * Fragment id for a post's article. Record keys are TIDs, so two posts in one
 * thread colliding would need two repos to mint the same microsecond and clock
 * id; the permalink route carries the author DID for the lookup that matters.
 */
export const postAnchor = (uri: string) => `post-${uri.split('/').pop()}`;

/** The author DID of a public or space post URI. */
export const postAuthor = (uri: string) => {
  const parts = uri.split('/');
  return parts[3] === 'space' ? parts[6] : parts[2];
};

/** Link to a post within its thread: a fragment for the thread itself, the
 *  permalink for a reply. */
export const postPath = (threadUri: string, uri: string, threadHref = threadPath(threadUri)) =>
  uri === threadUri ? `${threadHref}#${postAnchor(uri)}` : replyPath(threadUri, uri, threadHref);

/** Link that lands on one reply: resolved to its page for public threads,
 *  a plain fragment for space threads, which don't paginate. */
export const replyPath = (threadUri: string, replyUri: string, threadHref = threadPath(threadUri)) => {
  const t = parseAtUri(threadUri);
  const r = parseAtUri(replyUri);
  if (t && r) return `${threadHref}/p/${r.did}/${r.rkey}`;
  return `${threadPath(threadUri)}#${postAnchor(replyUri)}`;
};
