import { describe, expect, it } from 'vitest';
import { ACTIVE, actionFamily, actionKey, actionLabel, INVERSE, isThreadAction } from './moderation';

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

describe('by-hand stamp actions in the log (AE11)', () => {
  it('labels an award and a revocation by the stamp name', () => {
    expect(actionLabel({ action: 'awardStamp', stampName: 'helper' })).toBe('gave stamp helper');
    expect(actionLabel({ action: 'revokeStamp', stampName: 'helper' })).toBe('revoked stamp helper');
  });
  it('falls back to a generic label when the stamp record is gone', () => {
    expect(actionLabel({ action: 'awardStamp' })).toBe('gave stamp');
    expect(actionLabel({ action: 'revokeStamp' })).toBe('revoked stamp');
  });
  it('prints other kinds as they are', () => {
    expect(actionLabel({ action: 'ban' })).toBe('ban');
    expect(actionLabel({ action: 'acceptMember' })).toBe('acceptMember');
  });
  it('is neither an active flag nor undoable', () => {
    expect(ACTIVE.has('awardStamp')).toBe(false);
    expect(ACTIVE.has('revokeStamp')).toBe(false);
    expect(INVERSE.awardStamp).toBeUndefined();
    expect(INVERSE.revokeStamp).toBeUndefined();
  });
  it('is its own family, not a reversal of anything', () => {
    expect(actionFamily('awardStamp')).toBe('awardStamp');
    expect(actionFamily('revokeStamp')).toBe('revokeStamp');
  });
});
