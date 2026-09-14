import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallContext } from '@extism/extism';
import { ExtensionLimitError, extensionRuntime, type ExtensionModule, type RuntimeLimits } from './runtime';

// probe.wasm is built from fixtures/probe.js; see fixtures/README.md.
const probe = new URL('./fixtures/probe.wasm', import.meta.url).pathname;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The host side of probe.js: `wait` sleeps for the requested milliseconds,
// `load`/`save` read and write a counter after a short async delay.
function probeModule(state = { counter: 0 }): ExtensionModule {
  return {
    wasm: probe,
    functions: {
      async wait(context: CallContext, ptr: bigint) {
        const ms = Number(context.read(ptr)!.text());
        await sleep(ms);
        return context.store(`waited ${ms}`);
      },
      async load(context: CallContext) {
        await sleep(100);
        return context.store(String(state.counter));
      },
      save(context: CallContext, ptr: bigint) {
        state.counter = Number(context.read(ptr)!.text());
        return 0n;
      },
    },
  };
}

let runtime: ReturnType<typeof extensionRuntime> | null = null;
function start(limits: Partial<RuntimeLimits> = {}, load = async (_install: string) => probeModule()) {
  runtime = extensionRuntime(load, { timeoutMs: 2_000, memoryPages: 256, idleMs: 60_000, ...limits });
  return runtime;
}

afterEach(async () => {
  await runtime?.close();
  runtime = null;
  vi.unstubAllGlobals();
});

describe('extensionRuntime', () => {
  it('returns the echo export input unchanged', async () => {
    const rt = start();
    expect(await rt.call('one', 'echo', 'hello, forum')).toBe('hello, forum');
  });

  it('fails an infinite loop at the timeout while other installs keep answering, then recovers', async () => {
    const rt = start({ timeoutMs: 500 });
    await Promise.all([rt.call('spinner', 'echo', 'warm'), rt.call('bystander', 'echo', 'warm')]);
    const began = performance.now();
    const spin = rt.call('spinner', 'spin', '');
    const settled = spin.then(() => 'resolved', () => 'rejected');
    expect(await rt.call('bystander', 'echo', 'still here')).toBe('still here');
    expect(await Promise.race([settled, 'pending'])).toBe('pending');
    const error = await spin.catch((err) => err);
    expect(error).toBeInstanceOf(ExtensionLimitError);
    expect(error.limit).toBe('timeout');
    expect(performance.now() - began).toBeLessThan(1_500);
    expect(await rt.call('spinner', 'echo', 'back')).toBe('back');
  });

  it('fails a memory hog at the page limit without growing the Node heap', async () => {
    const rt = start({ memoryPages: 256 });
    await rt.call('hog', 'echo', 'warm');
    const before = process.memoryUsage().heapUsed;
    const error = await rt.call('hog', 'hog', '').catch((err) => err);
    expect(error).toBeInstanceOf(ExtensionLimitError);
    expect(error.limit).toBe('memory');
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(8 * 1024 * 1024);
    expect(await rt.call('hog', 'echo', 'back')).toBe('back');
  });

  it('refuses a module whose initial memory is already over the limit', async () => {
    const rt = start({ memoryPages: 8 });
    await expect(rt.call('big', 'echo', 'x')).rejects.toThrow(/memory pages/);
  });

  it('waits on an async host function inside the timeout but fails a guest busy-loop past it', async () => {
    const rt = start({ timeoutMs: 1_000 });
    await rt.call('clock', 'echo', 'warm');
    let began = performance.now();
    expect(await rt.call('clock', 'waitForHost', '500')).toBe('waited 500');
    expect(performance.now() - began).toBeGreaterThanOrEqual(495);
    began = performance.now();
    const error = await rt.call('clock', 'busy', '1500').catch((err) => err);
    expect(error).toBeInstanceOf(ExtensionLimitError);
    expect(error.limit).toBe('timeout');
    expect(performance.now() - began).toBeLessThan(1_450);
  });

  it('runs calls to one install in order, each seeing the last one’s host-side effect', async () => {
    const state = { counter: 0 };
    const rt = start({}, async () => probeModule(state));
    expect(await Promise.all([rt.call('one', 'tally', ''), rt.call('one', 'tally', '')])).toEqual(['1', '2']);
    expect(state.counter).toBe(2);
  });

  it('runs calls to different installs concurrently', async () => {
    const rt = start();
    await Promise.all([rt.call('a', 'echo', 'warm'), rt.call('b', 'echo', 'warm')]);
    const began = performance.now();
    expect(await Promise.all([rt.call('a', 'waitForHost', '400'), rt.call('b', 'waitForHost', '400')])).toEqual([
      'waited 400',
      'waited 400',
    ]);
    expect(performance.now() - began).toBeLessThan(700);
  });

  it('gives the guest no HTTP access and makes no outbound request', async () => {
    const fetch = vi.fn(async () => new Response('should not be reached'));
    vi.stubGlobal('fetch', fetch);
    const rt = start();
    await expect(rt.call('net', 'request', 'https://example.com/')).rejects.toThrow(/not allowed/);
    expect(fetch).not.toHaveBeenCalled();
    expect(await rt.call('net', 'echo', 'back')).toBe('back');
  });

  it('resolves to null for an export the module lacks, and keeps the instance working', async () => {
    const rt = start();
    expect(await rt.call('partial', 'timer', '')).toBeNull();
    expect(await rt.call('partial', 'echo', 'still here')).toBe('still here');
  });

  it('hands each call its own host context', async () => {
    const module = probeModule();
    module.functions.wait = (context: CallContext) => context.store(`context ${context.hostContext<string>()}`);
    const rt = start({}, async () => module);
    expect(await rt.call('ctx', 'waitForHost', '0', { hostContext: 'first' })).toBe('context first');
    expect(await rt.call('ctx', 'waitForHost', '0', { hostContext: 'second' })).toBe('context second');
  });

  it('fails a call whose output is longer than maxOutputBytes', async () => {
    const rt = start();
    const error = await rt.call('wordy', 'echo', 'x'.repeat(100), { maxOutputBytes: 99 }).catch((err) => err);
    expect(error).toBeInstanceOf(ExtensionLimitError);
    expect(error.limit).toBe('output');
    expect(await rt.call('wordy', 'echo', 'x'.repeat(99), { maxOutputBytes: 99 })).toBe('x'.repeat(99));
  });

  it('evicts an instance so the next call loads the install again', async () => {
    const load = vi.fn(async (_install: string) => probeModule());
    const rt = start({}, load);
    await rt.call('swap', 'echo', 'first');
    await rt.evict('swap');
    await rt.call('swap', 'echo', 'second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('runs a call on a one-off module in turn with the install, then loads the install fresh', async () => {
    const load = vi.fn(async (_install: string) => probeModule({ counter: 0 }));
    const rt = start({}, load);
    await rt.call('migrating', 'tally', '');
    expect(await rt.call('migrating', 'tally', '', { module: probeModule({ counter: 41 }) })).toBe('42');
    expect(load).toHaveBeenCalledTimes(1);
    expect(await rt.call('migrating', 'tally', '')).toBe('1');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('closes an idle instance and cold-starts it on the next call', async () => {
    const load = vi.fn(async (_install: string) => probeModule());
    const rt = start({ idleMs: 100 }, load);
    expect(await rt.call('idle', 'echo', 'first')).toBe('first');
    expect(await rt.call('idle', 'echo', 'warm')).toBe('warm');
    expect(load).toHaveBeenCalledTimes(1);
    await sleep(300);
    expect(await rt.call('idle', 'echo', 'cold')).toBe('cold');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
