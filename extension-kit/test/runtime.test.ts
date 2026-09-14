import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extensionRuntime } from '../../src/lib/server/extensions/runtime';
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

const call = async (runtime: ReturnType<typeof extensionRuntime>, action: string, input: unknown) =>
  JSON.parse((await runtime.call('install', 'action', JSON.stringify({ viewer: { did: null, standing: 'nonmember', staff: false, banned: false }, thread: null, action, input })))!);

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
