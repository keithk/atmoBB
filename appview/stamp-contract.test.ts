import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateRecord as validateMembership } from '../src/lexicon/types/app/atmobb/forum/membership';
import { validateRecord as validateStamp } from '../src/lexicon/types/app/atmobb/forum/stamp';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

describe('stamp public contract', () => {
  it('keeps the complete resolver identical across every stamp-bearing query', () => {
    const resolvers = ['getStamps', 'getThreadPage', 'getMembers', 'getMembership'].map((name) =>
      read(`./lua/${name}.lua`).split('local function resolve_stamps')[1].split('-- The worn entries')[0]);
    for (const resolver of resolvers) {
      expect(resolver).toBe(resolvers[0]);
      expect(resolver).toContain('#member.worn < 6');
      expect(resolver).toContain("r.default_rank <= 3");
      expect(resolver).toContain('entry.trigger = json.decode(row.trigger)');
      expect(resolver).toContain('triggerBoardName = row.trigger_board_name');
    }
  });

  it('allows six ordered choices and legacy omitted or empty choices', () => {
    const base = { $type: 'app.atmobb.forum.membership', forum: 'did:plc:member' };
    for (const wearing of [undefined, [], Array.from({ length: 6 }, (_, i) => `stamp-${i}`)]) {
      expect(validateMembership({ ...base, wearing }).success).toBe(true);
    }
    expect(validateMembership({ ...base, wearing: Array(7).fill('stamp') }).success).toBe(false);
  });

  it('keeps old looks valid and permits one complex grapheme, not two', () => {
    const base = {
      $type: 'app.atmobb.forum.stamp', name: 'Hello',
      trigger: { kind: 'byHand' }, createdAt: '2026-01-01T00:00:00Z',
    };
    for (const symbol of [undefined, 'E', '☀️', '👨‍👩‍👧‍👦']) {
      expect(validateStamp({ ...base, look: { bg: '#ffffff', ink: '#000000', shape: 'stamp', symbol } }).success).toBe(true);
    }
    expect(validateStamp({ ...base, look: { bg: '#ffffff', ink: '#000000', shape: 'stamp', symbol: 'AB' } }).success).toBe(false);
  });
});
