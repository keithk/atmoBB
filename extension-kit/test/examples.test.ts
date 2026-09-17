import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse, roll } from '../../examples/dice/src/notation';
import { extensionRuntime } from '../../src/lib/server/extensions/runtime';
import { build } from '../src/cli/build';
import { stubHost } from './stub-host';

// examples/dice is the extension the guide points authors at, so it has to
// build with the kit and behave in atmoBB's runtime.

const EXAMPLE = new URL('../../examples/dice', import.meta.url);
const THREAD = 'at://did:plc:forum/app.atmobb.discussion.thread/3kthread';
const OTHER_THREAD = 'at://did:plc:forum/app.atmobb.discussion.thread/3kother';
type Viewer = { did: string | null; standing: string; staff: boolean; banned: boolean };
const member: Viewer = { did: 'did:plc:member', standing: 'member', staff: false, banned: false };
const visitor: Viewer = { did: null, standing: 'nonmember', staff: false, banned: false };

describe('dice notation', () => {
  it('reads NdS with an optional modifier and writes it back one way', () => {
    expect(parse('2d6')).toEqual({ count: 2, sides: 6, modifier: 0, text: '2d6' });
    expect(parse('D20')).toEqual({ count: 1, sides: 20, modifier: 0, text: '1d20' });
    expect(parse(' 3d8 + 2 ')).toEqual({ count: 3, sides: 8, modifier: 2, text: '3d8+2' });
    expect(parse('4d10-1')).toEqual({ count: 4, sides: 10, modifier: -1, text: '4d10-1' });
  });

  it('refuses anything that is not dice or asks for too much', () => {
    for (const bad of ['', 'six', '2d', 'd1', '0d6', '21d6', 'd1001', '2d6+100', '2d6*2']) expect(parse(bad), bad).toBeNull();
  });

  it('rolls each die from 1 to its sides and adds the modifier', () => {
    const dice = parse('3d6+2')!;
    expect(roll(dice, () => 0)).toEqual({ rolls: [1, 1, 1], total: 5 });
    expect(roll(dice, () => 0.999)).toEqual({ rolls: [6, 6, 6], total: 20 });
  });
});

describe('dice extension', () => {
  let project: string;
  let wasm: string;
  const runtimes: ReturnType<typeof extensionRuntime>[] = [];

  beforeAll(async () => {
    project = await mkdtemp(join(tmpdir(), 'kit-dice-'));
    await cp(EXAMPLE, project, { recursive: true, filter: (source) => !/\/(node_modules|dist)(\/|$)/.test(source) });
    const result = await build({ projectDir: project });
    wasm = join(result.distDir, 'extension.wasm');
  });

  afterAll(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    await rm(project, { recursive: true, force: true });
  });

  /** A host whose record collection starts with `existing` rolls and keeps what the extension creates. */
  function start(existing: Record<string, unknown>[] = []) {
    const created: Record<string, unknown>[] = [];
    const host = stubHost({
      record_create: (p) => (created.push(p.record as Record<string, unknown>), { ok: true, value: { uri: `at://did:plc:forum/${p.collection}/3k${created.length}`, cid: 'bafy' } }),
      record_list: (p) => ({
        ok: true,
        value: { records: [...existing, ...created].map((value, i) => ({ uri: `at://did:plc:forum/${p.collection}/3k${i}`, cid: 'bafy', value })), truncated: false },
      }),
    });
    const runtime = extensionRuntime(async () => ({ wasm, functions: host.functions }));
    runtimes.push(runtime);
    const call = async (action: string, input: unknown, viewer: Viewer = member, thread: string | null = THREAD) =>
      JSON.parse((await runtime.call('install', 'action', JSON.stringify({ viewer, thread: thread ? { uri: thread } : null, forum: { did: 'did:plc:forum' }, action, input })))!);
    return { call, created };
  }

  it('rolls, writes the roll as a record, and answers the panel with it', async () => {
    const { call, created } = start();

    const { value } = await call('roll', { notation: '2d6+3' });

    expect(value.roll).toMatchObject({ thread: THREAD, by: member.did, notation: '2d6+3', modifier: 3 });
    expect(value.roll.rolls).toHaveLength(2);
    for (const die of value.roll.rolls) expect(die).toBeGreaterThanOrEqual(1);
    for (const die of value.roll.rolls) expect(die).toBeLessThanOrEqual(6);
    expect(value.roll.total).toBe(value.roll.rolls[0] + value.roll.rolls[1] + 3);
    expect(created).toEqual([{ $type: 'is.keith.dice.roll', ...value.roll }]);
  });

  it('refuses bad notation, rolling outside a thread, and rolling signed out', async () => {
    const { call, created } = start();

    expect((await call('roll', { notation: 'six' })).refused.code).toBe('bad_notation');
    expect((await call('roll', { notation: 'd20' }, member, null)).refused.code).toBe('not_in_thread');
    expect((await call('roll', { notation: 'd20' }, visitor)).refused.code).toBe('sign_in');
    expect(created).toEqual([]);
  });

  it('lists a thread\'s rolls newest first, and the whole forum\'s on the extension page', async () => {
    const at = (n: number) => `2026-09-16T12:00:0${n}.000Z`;
    const rolls = [
      { thread: THREAD, by: member.did, notation: '1d20', rolls: [7], modifier: 0, total: 7, createdAt: at(1) },
      { thread: OTHER_THREAD, by: member.did, notation: '1d6', rolls: [2], modifier: 0, total: 2, createdAt: at(2) },
      { thread: THREAD, by: 'did:plc:other', notation: '2d4', rolls: [1, 4], modifier: 0, total: 5, createdAt: at(3) },
    ];
    const { call } = start(rolls.map((r) => ({ $type: 'is.keith.dice.roll', ...r })));

    const thread = await call('history', null, visitor);
    const page = await call('history', null, visitor, null);

    expect(thread.value.rolls.map((r: { createdAt: string }) => r.createdAt)).toEqual([at(3), at(1)]);
    expect(page.value.rolls.map((r: { createdAt: string }) => r.createdAt)).toEqual([at(3), at(2), at(1)]);
  });
});
