import type { JoinMode, Standing } from '$lib/membership';

/** What the applicant's own application is doing right now, or none when they have none open. */
export type ApplicantState = 'none' | 'pending' | 'waiting' | 'denied';

/**
 * What /apply shows. Only `form` renders the application form; the rest are
 * one-line notices about why there is nothing to fill in.
 */
export type ApplyView =
  | { kind: 'banned'; message: string }
  | { kind: 'open' }
  | { kind: 'invite' }
  | { kind: 'member' }
  | { kind: 'accepted' }
  | { kind: 'pending' }
  | { kind: 'waiting' }
  | { kind: 'form'; declined: boolean };

export function applyView(mode: JoinMode, standing: Standing, state: ApplicantState): ApplyView {
  if (mode === 'open') return { kind: 'open' };
  if (mode === 'invite') return { kind: 'invite' };
  if (standing === 'member' || standing === 'exempt') return { kind: 'member' };
  if (standing === 'accepted-undeclared') return { kind: 'accepted' };
  if (state === 'pending' || state === 'waiting') return { kind: state };
  return { kind: 'form', declined: state === 'denied' };
}

/** Whether a new application may be written: only from the form view (R9). */
export function canApply(mode: JoinMode, standing: Standing, state: ApplicantState): boolean {
  return applyView(mode, standing, state).kind === 'form';
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The lexicon's cap on an application note. */
export const NOTE_MAX_GRAPHEMES = 300;

export function noteTooLong(note: string): boolean {
  let n = 0;
  for (const _ of segmenter.segment(note)) if (++n > NOTE_MAX_GRAPHEMES) return true;
  return false;
}
