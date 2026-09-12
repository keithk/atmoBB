import { parseAtUri } from './appview-paths';

/** A watch record as listed from the member's repo; `board` is checked, not trusted. */
export interface WatchRecord {
  uri: string;
  value: { board?: unknown };
}

export interface Watch {
  board: string;
  uri: string;
}

// The watch collection is shared by every atmobb forum a member uses, so
// only records whose board lives on this forum's DID count here.
export function watchesForForum(records: WatchRecord[], forumDid: string): Watch[] {
  return records.flatMap((r) => {
    const board = r.value.board;
    return typeof board === 'string' && parseAtUri(board)?.did === forumDid ? [{ board, uri: r.uri }] : [];
  });
}

export function planWatch(existing: Watch[], boardUri: string): { create: boolean } {
  return { create: !existing.some((w) => w.board === boardUri) };
}

export function planUnwatch(existing: Watch[], boardUri: string): string[] {
  return existing.filter((w) => w.board === boardUri).map((w) => w.uri);
}
