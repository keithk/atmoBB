import { defineExtension, kv, records, timers } from 'atmobb-extension-kit';

// A counter. Members press a button and the count lives in the extension's
// k/v store. When staff attach the counter to a thread, a tally record in the
// forum's repo binds it there and carries the latest count. A timer resets
// the count a day after the last press.

const TALLY = 'com.example.counter.tally';
/** The counter has one tally record, so it always lives at the same record key. */
const TALLY_RKEY = 'counter';
const RESET_AFTER_MS = 24 * 60 * 60 * 1000;

/** Write the tally record when the counter is attached to a thread. */
function publishTally(count: number) {
  const thread = kv.get<string>('thread');
  if (!thread) return;
  records.put({ collection: TALLY, rkey: TALLY_RKEY, record: { $type: TALLY, thread, count, updatedAt: new Date().toISOString() } });
}

export default defineExtension({
  action({ viewer, action, input }) {
    const count = kv.get<number>('count') ?? 0;

    switch (action) {
      case 'show':
        return { count };

      case 'attach': {
        const { thread } = (input ?? {}) as { thread?: unknown };
        if (!viewer.staff) throw new Error('Only staff can attach the counter');
        if (typeof thread !== 'string' || !thread.startsWith('at://')) throw new Error('input.thread must be the thread at-uri');
        kv.set('thread', thread);
        publishTally(count);
        return { count };
      }

      case 'increment': {
        if (!viewer.did || viewer.banned) throw new Error('Sign in to count');
        const next = count + 1;
        kv.set('count', next);
        publishTally(next);
        // Setting the same timer name again pushes the reset back.
        timers.set({ name: 'reset', at: new Date(Date.now() + RESET_AFTER_MS).toISOString() });
        return { count: next };
      }

      default:
        throw new Error(`Unknown action ${action}`);
    }
  },

  timer({ name }) {
    if (name !== 'reset') return;
    kv.set('count', 0);
    publishTally(0);
  },
});
