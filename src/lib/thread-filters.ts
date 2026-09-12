import { parseThreadTags } from './thread-tags';

export interface ThreadFilters {
  q?: string;
  board?: string;
  tag?: string;
}

export function threadFilters(params: URLSearchParams): ThreadFilters {
  const q = params.get('q')?.trim().slice(0, 200) || undefined;
  const candidateBoard = params.get('board')?.trim();
  const board = candidateBoard?.startsWith('at://') ? candidateBoard : undefined;
  const parsedTag = parseThreadTags(params.get('tag') ?? '');
  const tag = !parsedTag.error && parsedTag.tags.length === 1 ? parsedTag.tags[0] : undefined;
  return { q, board, tag };
}

/** Filter links reset pagination; cursor links preserve the active filters. */
export function threadFilterHref(filters: ThreadFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.board) params.set('board', filters.board);
  if (filters.tag) params.set('tag', filters.tag);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query ? `?${query}` : '';
}
