import type { CallContext } from '@extism/extism';
import { HOST_FUNCTIONS, type HostFunctionName, type HostResult } from '../../../../src/lib/extensions/contract';
import type { HostFunction } from '../../../../src/lib/server/extensions/runtime';

type Answer = (payload: Record<string, unknown>) => HostResult<unknown>;

/**
 * Every host function the guest imports, answering the way atmoBB's host does:
 * k/v over an in-memory map, and `capability_not_granted` for anything
 * `overrides` doesn't answer. `calls` records each payload as the host read it.
 */
export function stubHost(overrides: Partial<Record<HostFunctionName, Answer>> = {}) {
  const kv = new Map<string, unknown>();
  const calls: { name: HostFunctionName; payload: Record<string, unknown> }[] = [];
  const answers: Record<HostFunctionName, Answer> = {
    ...(Object.fromEntries(
      Object.keys(HOST_FUNCTIONS).map((name) => [
        name,
        () => ({ ok: false, error: { code: 'capability_not_granted', message: `${name} isn't granted` } }),
      ]),
    ) as unknown as Record<HostFunctionName, Answer>),
    kv_get: (p) => ({ ok: true, value: { value: kv.has(p.key as string) ? kv.get(p.key as string) : null } }),
    kv_set: (p) => (kv.set(p.key as string, p.value), { ok: true, value: null }),
    kv_delete: (p) => (kv.delete(p.key as string), { ok: true, value: null }),
    kv_list: (p) => ({ ok: true, value: { keys: [...kv.keys()].filter((k) => k.startsWith(p.prefix as string)).sort(), cursor: null } }),
    ...overrides,
  };
  const functions = Object.fromEntries(
    (Object.keys(answers) as HostFunctionName[]).map((name) => [
      name,
      ((context: CallContext, ptr: bigint) => {
        const payload = JSON.parse(context.read(ptr)!.text());
        calls.push({ name, payload });
        return context.store(JSON.stringify(answers[name](payload)));
      }) satisfies HostFunction,
    ]),
  );
  return { kv, calls, functions };
}
