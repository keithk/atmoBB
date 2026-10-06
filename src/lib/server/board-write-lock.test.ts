import { expect, it } from 'vitest';
import { withBoardWrite } from './board-write-lock';

it('holds a same-board write behind a privacy transition without blocking other boards', async () => {
  const events: string[] = [];
  let finish!: () => void;
  const transition = withBoardWrite('board', async () => {
    events.push('transition');
    await new Promise<void>((resolve) => { finish = resolve; });
  });
  await Promise.resolve();
  const post = withBoardWrite('board', async () => { events.push('post'); });
  await withBoardWrite('other', async () => { events.push('other'); });
  expect(events).toEqual(['transition', 'other']);
  finish();
  await Promise.all([transition, post]);
  expect(events).toEqual(['transition', 'other', 'post']);
});

it('releases the board after a failed transition', async () => {
  await expect(withBoardWrite('board', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  expect(await withBoardWrite('board', async () => 'ready')).toBe('ready');
});
