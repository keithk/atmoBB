// Test extension for runtime.test.ts: passes values through the author API.
import { HostCallError, defineExtension, kv, notify } from 'atmobb-extension-kit';

export default defineExtension({
  action({ action, input }) {
    const args = input as { key: string; value: unknown };
    switch (action) {
      case 'kv':
        kv.set(args.key, args.value);
        return { read: kv.get(args.key), listed: kv.list(args.key) };
      case 'refused':
        try {
          notify({ to: [], title: 'hello', message: 'hello' });
          return 'no error';
        } catch (error) {
          const e = error as HostCallError;
          return { isHostCallError: error instanceof HostCallError, name: e.name, code: e.code, fn: e.fn, message: e.message };
        }
      default:
        throw new Error(`unknown action ${action}`);
    }
  },
  openWork() {
    return kv.get('open') === true;
  },
});
