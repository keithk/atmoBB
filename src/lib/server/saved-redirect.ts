import { redirect } from '@sveltejs/kit';
import { awaitIndexed } from './appview';
import { forumWriteMode } from './forum-repo';

/**
 * Redirect after an admin save, holding the redirect until the appview has
 * indexed the write (`landed` returns true for a fresh `read`), so the page
 * the admin lands on already shows the change. If the write doesn't land
 * before the deadline, append pending=1 so the page can say it's still on
 * its way. Index-mode writes are synchronous, so those skip the wait.
 */
export async function savedRedirect<T>(
  dest: string,
  read: () => Promise<T>,
  landed: (data: T) => boolean,
): Promise<never> {
  const pending = forumWriteMode() === 'pds' && !(await awaitIndexed(read, landed));
  if (pending) dest += (dest.includes('?') ? '&' : '?') + 'pending=1';
  redirect(303, dest);
}
