import { describe, expect, it } from 'vitest';
import { planUnwatch, planWatch, watchesForForum } from './watch';

const forum = 'did:plc:forum';
const other = 'did:plc:otherforum';
const x = `at://${forum}/app.atmobb.forum.board/xxx`;
const y = `at://${forum}/app.atmobb.forum.board/yyy`;
const z = `at://${forum}/app.atmobb.forum.board/zzz`;
const elsewhere = `at://${other}/app.atmobb.forum.board/xxx`;

const rec = (rkey: string, board: string) => ({
  uri: `at://did:plc:member/app.atmobb.forum.watch/${rkey}`,
  value: { board },
});

describe('watchesForForum', () => {
  it("keeps only records whose board belongs to this forum's DID", () => {
    const records = [rec('1', x), rec('2', elsewhere), rec('3', y)];
    expect(watchesForForum(records, forum).map((r) => r.uri)).toEqual([rec('1', x).uri, rec('3', y).uri]);
  });
});

describe('planWatch', () => {
  const existing = watchesForForum([rec('1', x), rec('2', y)], forum);
  it('plans no create when the board is already watched', () => {
    expect(planWatch(existing, x)).toEqual({ create: false });
  });
  it('plans one create for an unwatched board', () => {
    expect(planWatch(existing, z)).toEqual({ create: true });
  });
});

describe('planUnwatch', () => {
  it('plans one delete per matching record and leaves the rest alone', () => {
    const existing = watchesForForum([rec('1', x), rec('2', y), rec('3', x)], forum);
    expect(planUnwatch(existing, x)).toEqual([rec('1', x).uri, rec('3', x).uri]);
    expect(planUnwatch(existing, z)).toEqual([]);
  });
  it("never deletes another forum's watch of a board with the same rkey", () => {
    const existing = watchesForForum([rec('1', elsewhere)], forum);
    expect(planUnwatch(existing, x)).toEqual([]);
  });
});
