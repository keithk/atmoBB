import { defineExtension, kv, records, timers } from 'atmobb-extension-kit';

// A counter for threads. Staff attach it to a thread, and members press a
// button in the thread's panel. Each thread keeps its own count in the
// extension's k/v store and publishes it as a tally record in the forum's
// repo. A timer resets a thread's count a day after its last press.

const TALLY = 'com.example.counter.tally';
const RESET_AFTER_MS = 24 * 60 * 60 * 1000;

/** What the counter keeps for one thread: its count and its tally record's key. */
interface ThreadCounter {
  count: number;
  tally: string;
}

const counterKey = (thread: string) => `thread:${thread}`;

function saveCount(thread: string, counter: ThreadCounter, count: number) {
  kv.set(counterKey(thread), { ...counter, count });
  records.put({ collection: TALLY, rkey: counter.tally, record: { $type: TALLY, thread, count, updatedAt: new Date().toISOString() } });
}

export default defineExtension({
  // atmoBB calls attach once staff have bound the counter to a thread. `input`
  // is whatever the attach form sent. Throwing refuses the attach.
  attach({ thread, input }) {
    const { start = 0 } = (input ?? {}) as { start?: unknown };
    if (typeof start !== 'number' || !Number.isInteger(start) || start < 0) throw new Error('start must be a whole number, 0 or more');
    const { uri } = records.create({ collection: TALLY, record: { $type: TALLY, thread: thread.uri, count: start, updatedAt: new Date().toISOString() } });
    kv.set(counterKey(thread.uri), { count: start, tally: uri.split('/').pop()! } satisfies ThreadCounter);
    return { count: start };
  },

  action({ viewer, thread, action }) {
    if (!thread) throw new Error('The counter only runs in a thread');
    const counter = kv.get<ThreadCounter>(counterKey(thread.uri));
    if (!counter) throw new Error("The counter isn't set up for this thread");

    switch (action) {
      case 'show':
        return { count: counter.count };

      case 'increment': {
        if (!viewer.did || viewer.banned) throw new Error('Sign in to count');
        const next = counter.count + 1;
        saveCount(thread.uri, counter, next);
        // Setting the same timer name again pushes the reset back.
        timers.set({ name: `reset:${thread.uri}`, at: new Date(Date.now() + RESET_AFTER_MS).toISOString(), payload: { thread: thread.uri } });
        return { count: next };
      }

      default:
        throw new Error(`Unknown action ${action}`);
    }
  },

  timer({ payload }) {
    const { thread } = (payload ?? {}) as { thread?: string };
    const counter = thread ? kv.get<ThreadCounter>(counterKey(thread)) : null;
    if (thread && counter) saveCount(thread, counter, 0);
  },
});
