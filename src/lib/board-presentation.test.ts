import { describe, expect, it } from 'vitest';
import { groupBoards, normalizeBoardColor, parseBoardColor, withBoardColor } from './board-presentation';

const board = (uri: string, name: string, extra: Record<string, unknown> = {}) => ({
  uri,
  value: { name, ...extra },
  threadCount: 0,
  replyCount: 0,
});

describe('board colors', () => {
  it('normalizes full hex colors and rejects unsafe or abbreviated values', () => {
    expect(normalizeBoardColor(' #A1b2C3 ')).toBe('#a1b2c3');
    expect(normalizeBoardColor('#abc')).toBeUndefined();
    expect(normalizeBoardColor('red; background: url(x)')).toBeUndefined();
  });

  it('allows a blank color and reports malformed form values', () => {
    expect(parseBoardColor('')).toEqual({ valid: true });
    expect(parseBoardColor('#12ff8a')).toEqual({ valid: true, color: '#12ff8a' });
    expect(parseBoardColor('#12ff8')).toEqual({ valid: false });
  });

  it('preserves unrelated board settings when setting and clearing color', () => {
    const original = { name: 'Private', topic: 'music', access: { space: 'at://space' } };
    expect(withBoardColor(original, '#123456')).toEqual({ ...original, color: '#123456' });
    expect(withBoardColor({ ...original, color: '#123456' })).toEqual(original);
  });
});

describe('groupBoards', () => {
  it('preserves category, board, and child order without exposing content metadata', () => {
    const privateBoard = board('at://f/board/private', 'Private', {
      category: 'at://f/category/two',
      access: { space: 'at://f/space/private' },
    });
    const groups = groupBoards(
      [
        board('at://f/board/second', 'Second', { category: 'at://f/category/two' }),
        privateBoard,
        board('at://f/board/parent', 'Parent'),
        board('at://f/board/child', 'Child', { parent: 'at://f/board/parent' }),
      ],
      [
        { uri: 'at://f/category/one', value: { name: 'One' } },
        { uri: 'at://f/category/two', value: { name: 'Two' } },
      ],
    );

    expect(groups.map((group) => group.name)).toEqual(['Two', 'Boards']);
    expect(groups[0].boards.map((item) => item.value.name)).toEqual(['Second', 'Private']);
    expect(groups[0].boards[1].value.access).toEqual({ space: 'at://f/space/private' });
    expect(groups[1].boards[0].children.map((item) => item.value.name)).toEqual(['Child']);
  });
});
