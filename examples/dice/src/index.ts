import { defineExtension, records, refuse } from 'atmobb-extension-kit';
import { parse, roll } from './notation';

// A dice roller for play-by-post threads. Staff attach it to a thread, members
// type dice notation in the panel, and every roll is written to the forum's
// repo as a record by the forum account, so a player can't forge one. The
// extension's own page lists the forum's recent rolls.

const ROLL = 'is.keith.dice.roll';
const HISTORY = 20;

interface Roll {
  thread: string;
  by: string;
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
  createdAt: string;
}

/** The newest rolls, in one thread or across the forum. */
function history(thread: string | null): Roll[] {
  const { records: stored } = records.list({ collection: ROLL });
  return stored
    .map((record) => record.value as unknown as Roll)
    .filter((entry) => !thread || entry.thread === thread)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, HISTORY);
}

export default defineExtension({
  // There's nothing to set up. Exporting `attach` is what lets staff attach
  // the roller to a thread; without it, atmoBB never offers to.
  attach() {
    return {};
  },

  action({ viewer, thread, action, input }) {
    switch (action) {
      case 'history':
        return { rolls: history(thread?.uri ?? null) };

      case 'roll': {
        if (!thread) refuse('Rolling happens in a thread.', 'not_in_thread');
        if (!viewer.did || viewer.banned) refuse('Sign in to roll.', 'sign_in');
        const { notation } = (input ?? {}) as { notation?: unknown };
        const dice = parse(typeof notation === 'string' ? notation : '');
        if (!dice) refuse('Write dice like 2d6, d20, or 3d8+2. Up to 20 dice of up to 1000 sides.', 'bad_notation');
        const { rolls, total } = roll(dice);
        const entry: Roll = { thread: thread.uri, by: viewer.did, notation: dice.text, rolls, modifier: dice.modifier, total, createdAt: new Date().toISOString() };
        records.create({ collection: ROLL, record: { $type: ROLL, ...entry } });
        return { roll: entry };
      }

      default:
        throw new Error(`Unknown action ${action}`);
    }
  },
});
