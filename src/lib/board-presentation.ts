import type { BoardIndex } from '$lib/server/appview';

export const BOARD_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** Accept only CSS-safe, full-length hex colors from indexed or form data. */
export function normalizeBoardColor(value: unknown): string | undefined {
  return typeof value === 'string' && BOARD_COLOR_PATTERN.test(value.trim())
    ? value.trim().toLowerCase()
    : undefined;
}

export function parseBoardColor(value: FormDataEntryValue | null):
  | { valid: true; color?: string }
  | { valid: false } {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true };
  const color = normalizeBoardColor(raw);
  return color ? { valid: true, color } : { valid: false };
}

/** Copy a board record while setting or explicitly clearing its optional color. */
export function withBoardColor<T extends Record<string, unknown>>(record: T, color?: string): T {
  const next: T & { color?: string } = { ...record };
  if (color) next.color = color;
  else delete next.color;
  return next;
}

type Board = BoardIndex['boards'][number];
type Category = NonNullable<BoardIndex['categories']>[number];

export interface BoardGroup {
  uri?: string;
  name: string;
  boards: (Board & { children: Board[] })[];
}

/** Preserve appview order while grouping top-level boards and their children. */
export function groupBoards(boards: Board[], categories: Category[]): BoardGroup[] {
  const topLevel = boards.filter((board) => !board.value.parent);
  const children = (uri: string) => boards.filter((board) => board.value.parent === uri);
  const categoryUris = new Set(categories.map((category) => category.uri));
  const addChildren = (board: Board) => ({ ...board, children: children(board.uri) });

  return [
    ...categories.map((category) => ({
      uri: category.uri,
      name: category.value.name,
      boards: topLevel.filter((board) => board.value.category === category.uri).map(addChildren),
    })),
    {
      name: 'Boards',
      boards: topLevel
        .filter((board) => !board.value.category || !categoryUris.has(board.value.category))
        .map(addChildren),
    },
  ].filter((group) => group.boards.length > 0);
}
