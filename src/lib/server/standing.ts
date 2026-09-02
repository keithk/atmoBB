import { getStanding, FORUM_DID } from './appview';
import { banCovering, type Ban } from '$lib/standing';

/**
 * The ban keeping `did` off `board` (or off the forum entirely), if any.
 *
 * For public writes, appview trouble reads as "not banned": the public index
 * enforces bans at read time too, so a write that slips through still won't
 * show. Space writes have no such backstop (space reads bypass the index), so
 * callers pass `strict` and the appview error propagates, blocking the write.
 */
export async function bannedFrom(
  did: string,
  board?: string,
  opts: { strict?: boolean } = {},
): Promise<Ban | undefined> {
  try {
    const standing = await getStanding(did, FORUM_DID());
    return banCovering(standing.bans, board);
  } catch (e) {
    if (opts.strict) throw e;
    return undefined;
  }
}

/** The message a banned member sees when a write is refused. */
export function banMessage(ban: Ban): string {
  const until = ban.until ? ` until ${new Date(ban.until).toLocaleDateString()}` : '';
  const why = ban.reason ? ` Reason: ${ban.reason}` : '';
  return `You're banned from posting ${ban.board ? 'on this board' : 'here'}${until}.${why}`;
}
