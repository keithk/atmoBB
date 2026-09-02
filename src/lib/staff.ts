/** A staff grant as the appview reports it: role plus an optional board scope. */
export interface StaffGrant {
  subject: string;
  role: string;
  boards?: string[];
}

/**
 * Whether a grant lets its holder moderate a board. Admins cover the whole
 * forum, and so does a moderator grant that names no boards; a scoped
 * moderator grant covers exactly the boards it lists.
 */
export function grantCovers(grant: StaffGrant, board: string): boolean {
  if (grant.role === 'admin') return true;
  if (!grant.boards?.length) return true;
  return grant.boards.includes(board);
}
