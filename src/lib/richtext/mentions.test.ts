import { describe, expect, it } from 'vitest';
import { detectMentionCharacters, detectMentions } from './mentions';

describe('mention detection', () => {
  it('returns editor character offsets and wire byte offsets independently', () => {
    const text = '猫 says (@Trezy.Codes)';
    expect(detectMentionCharacters(text)).toEqual([
      { handle: 'Trezy.Codes', start: 8, end: 20 },
    ]);
    expect(detectMentions(text)).toEqual([
      { handle: 'Trezy.Codes', byteStart: 10, byteEnd: 22 },
    ]);
  });

  it('does not decorate email addresses or single-label names', () => {
    expect(detectMentionCharacters('mail me@example.com or ask @alice')).toEqual([]);
  });
});
