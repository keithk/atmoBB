import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extensionRuntime } from '../../../../src/lib/server/extensions/runtime';
import { build } from '../src/cli/build';
import { stubHost } from './stub-host';

// The author API only means something inside the sandbox, so these build a
// small extension with the kit and drive it through atmoBB's runtime.

let project: string;
let wasm: string;
const runtimes: ReturnType<typeof extensionRuntime>[] = [];

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'kit-roundtrip-'));
  await cp(new URL('./fixtures/roundtrip', import.meta.url), project, { recursive: true });
  const result = await build({ projectDir: project });
  wasm = join(result.distDir, 'extension.wasm');
});

afterAll(async () => {
  await Promise.all(runtimes.map((runtime) => runtime.close()));
  await rm(project, { recursive: true, force: true });
});

function start(host: ReturnType<typeof stubHost>) {
  const runtime = extensionRuntime(async () => ({ wasm, functions: host.functions }));
  runtimes.push(runtime);
  return runtime;
}

const output = async (runtime: ReturnType<typeof extensionRuntime>, action: string, input: unknown) =>
  JSON.parse(
    (await runtime.call(
      'install',
      'action',
      JSON.stringify({ viewer: { did: null, standing: 'nonmember', staff: false, banned: false }, thread: null, forum: { did: 'did:plc:forum' }, action, input }),
    ))!,
  );

/** The action's return value, out of the { value } envelope. */
async function call(runtime: ReturnType<typeof extensionRuntime>, action: string, input: unknown) {
  const envelope = await output(runtime, action, input);
  expect(Object.keys(envelope)).toEqual(['value']);
  return envelope.value;
}

describe('author runtime', () => {
  it('round-trips Unicode and nested objects through k/v without loss', async () => {
    const host = stubHost();
    const runtime = start(host);
    const value = {
      title: 'Ünïcödé — 日本語 ✓ 🎲🇫🇷',
      family: '👩‍👩‍👧',
      separators: 'line\u2028paragraph\u2029nul\u0000end',
      quotes: `"double" 'single' \\back\\ \n\t`,
      nested: { list: [1, 'two', { three: [null, true, 3.5, -0.25] }], empty: {}, none: [] },
    };

    const output = await call(runtime, 'kv', { key: 'état/🎲', value });

    expect(host.kv.get('état/🎲')).toEqual(value);
    expect(output).toEqual({ read: value, listed: { keys: ['état/🎲'], cursor: null } });
  });

  it('throws a HostCallError carrying the code when the host answers ok: false', async () => {
    const runtime = start(stubHost());

    expect(await call(runtime, 'refused', null)).toEqual({
      isHostCallError: true,
      name: 'HostCallError',
      code: 'capability_not_granted',
      fn: 'notify',
      message: "notify isn't granted",
    });
  });

  it('outputs a refusal as { refused: { code, message } }, capping the message and defaulting the code', async () => {
    const runtime = start(stubHost());

    expect(await output(runtime, 'refuse', { message: 'You have no army in Paris.', code: 'no_army' })).toEqual({
      refused: { code: 'no_army', message: 'You have no army in Paris.' },
    });
    expect(await output(runtime, 'refuse', { message: 'Not now.' })).toEqual({ refused: { code: 'refused', message: 'Not now.' } });
    const long = await output(runtime, 'refuse', { message: 'x'.repeat(1000) });
    expect(long.refused.message).toHaveLength(300);
  });

  it('fails the call, rather than refusing, for a malformed refusal or any other throw', async () => {
    const runtime = start(stubHost());

    await expect(output(runtime, 'refuse', { message: 'Bad code', code: 'Not A Code' })).rejects.toThrow();
    await expect(output(runtime, 'refuse', { message: '' })).rejects.toThrow();
    await expect(output(runtime, 'nonsense', null)).rejects.toThrow();
  });

  it('gives Math.random a different sequence on each cold start', async () => {
    const first = await call(start(stubHost()), 'random', null);
    const second = await call(start(stubHost()), 'random', null);

    expect(first).toHaveLength(3);
    for (const n of [...first, ...second]) expect(n >= 0 && n < 1).toBe(true);
    expect(second).not.toEqual(first);
  });

  it('exports only the handlers the extension defines', async () => {
    const host = stubHost();
    host.kv.set('open', true);
    const runtime = start(host);

    expect(await runtime.call('install', 'openWork', '')).toBe('true');
    expect(await runtime.call('install', 'attach', JSON.stringify({ thread: { uri: 'at://did:plc:forum/app.atmobb.discussion.thread/3k' }, input: {} }))).toBeNull();
    expect(await runtime.call('install', 'timer', JSON.stringify({ name: 'x', at: new Date().toISOString() }))).toBeNull();
    expect(await runtime.call('install', 'migrate', JSON.stringify({ from: 1, to: 2 }))).toBeNull();
  });
});
