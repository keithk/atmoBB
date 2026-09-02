import { describe, expect, it } from 'vitest';
import { actionFamily, actionKey, INVERSE, isThreadAction } from './moderation';

describe('moderation helpers', () => {
  it('pairs every action with its inverse both ways', () => {
    for (const [a, b] of Object.entries(INVERSE)) expect(INVERSE[b]).toBe(a);
  });
  it('folds on/off actions into one family', () => {
    expect(actionFamily('unlock')).toBe('lock');
    expect(actionFamily('pin')).toBe('pin');
    expect(actionFamily('block')).toBe('block');
  });
  it('keys a thread by flag so a hide and a lock coexist', () => {
    const uri = 'at://did:plc:a/app.atmobb.discussion.thread/1';
    expect(actionKey({ subject: { uri }, action: 'hide' })).not.toBe(actionKey({ subject: { uri }, action: 'lock' }));
    expect(actionKey({ subject: { uri }, action: 'lock' })).toBe(actionKey({ subject: { uri }, action: 'unlock' }));
  });
  it('keys a forum block by board, with forum-wide as its own scope', () => {
    const did = 'did:plc:b';
    expect(actionKey({ subject: { did }, action: 'block' })).not.toBe(
      actionKey({ subject: { did }, action: 'block', board: 'at://x/y/z' }),
    );
  });
  it('recognizes only thread flag actions', () => {
    expect(isThreadAction('pin')).toBe(true);
    expect(isThreadAction('block')).toBe(false);
  });
});
