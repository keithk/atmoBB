/** Moderation actions that flip a thread flag on and off, in pairs. */
export const THREAD_ACTIONS = ['hide', 'unhide', 'lock', 'unlock', 'pin', 'unpin'] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];

export const isThreadAction = (a: string): a is ThreadAction =>
  (THREAD_ACTIONS as readonly string[]).includes(a);

/** The action that reverses another, for undo. */
export const INVERSE: Record<string, string> = {
  hide: 'unhide',
  unhide: 'hide',
  lock: 'unlock',
  unlock: 'lock',
  pin: 'unpin',
  unpin: 'pin',
  block: 'unblock',
  unblock: 'block',
};

/** Actions that leave something in force until reversed. */
export const ACTIVE = new Set(['hide', 'lock', 'pin', 'block', 'ban']);

/** hide/unhide -> hide, lock/unlock -> lock, and so on; others map to themselves. */
export const actionFamily = (action: string) => action.replace(/^un/, '');

/** By-hand stamp awards and revocations: logged like any action, never in force, nothing to undo. */
export const STAMP_ACTIONS = ['awardStamp', 'revokeStamp'] as const;

/** How the log names an action. Stamp actions read as a sentence with the stamp's name; other kinds print as they are. */
export function actionLabel(a: { action: string; stampName?: string | null }): string {
  const verb = { awardStamp: 'gave stamp', revokeStamp: 'revoked stamp' }[a.action];
  if (!verb) return a.action;
  return a.stampName ? `${verb} ${a.stampName}` : verb;
}

export interface ActionLike {
  subject: { uri?: string; did?: string };
  action: string;
  board?: string;
}

/**
 * Identity of the thing an action changes: one thread flag, or one forum's
 * standing on one board (or forum-wide). The latest action per key wins.
 */
export const actionKey = (a: ActionLike) =>
  a.subject.uri
    ? `${a.subject.uri}|${actionFamily(a.action)}`
    : `${a.subject.did}|${a.board ?? '*'}|${actionFamily(a.action)}`;
