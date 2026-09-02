import { describe, expect, it } from 'vitest';
import { blocksToPlainText } from './plain';

const NS = 'app.atmobb.richtext';

describe('blocksToPlainText', () => {
  it('joins text, quotes, and code, and skips images', () => {
    expect(
      blocksToPlainText([
        { $type: `${NS}.block#text`, text: 'one' },
        { $type: `${NS}.block#image`, image: {} },
        { $type: `${NS}.block#quote`, text: 'two' },
        { $type: `${NS}.block#code`, text: 'x = 3' },
      ]),
    ).toBe('one\n\ntwo\n\nx = 3');
  });
});
