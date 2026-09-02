import type { Poll } from './server/appview';

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 10;
export const POLL_MAX_DAYS = 365;

export interface PollFields {
  question: string;
  /** One option per line. */
  options: string;
  multiple: boolean;
  /** Days the poll runs, blank or 0 for no closing time. */
  days: string;
}

export type ParsedPoll = { poll: Poll } | { error: string } | null;

/**
 * Turn the composer's poll fields into a thread's poll object. Null when the
 * author left the poll alone (no options), an error for a half-filled one.
 */
export function parsePoll(fields: PollFields, now = new Date()): ParsedPoll {
  const options = fields.options
    .split(/\r?\n/)
    .map((o) => o.trim())
    .filter(Boolean);
  const question = fields.question.trim();
  if (!options.length) {
    return question ? { error: 'Give the poll at least two options, one per line.' } : null;
  }
  if (options.length < POLL_MIN_OPTIONS) return { error: 'A poll needs at least two options.' };
  if (options.length > POLL_MAX_OPTIONS) return { error: `A poll can have at most ${POLL_MAX_OPTIONS} options.` };
  if (options.some((o) => [...o].length > 100)) return { error: 'Keep each option under 100 characters.' };
  if ([...question].length > 300) return { error: 'Keep the question under 300 characters.' };
  const days = fields.days.trim() ? Number(fields.days) : 0;
  if (!Number.isFinite(days) || days < 0 || days > POLL_MAX_DAYS) {
    return { error: `The poll can run for up to ${POLL_MAX_DAYS} days.` };
  }
  return {
    poll: {
      ...(question ? { question } : {}),
      options,
      ...(fields.multiple ? { multipleChoice: true } : {}),
      ...(days > 0 ? { closesAt: new Date(now.getTime() + days * 86_400_000).toISOString() } : {}),
    },
  };
}

/** Whether voting has ended. */
export const pollClosed = (poll: Poll, now = new Date()) => !!poll.closesAt && new Date(poll.closesAt) <= now;
