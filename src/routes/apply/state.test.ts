import { describe, expect, it } from 'vitest';
import { applyView, canApply, noteTooLong } from './state';

describe('applyView', () => {
  it('explains the mode before looking at the person', () => {
    expect(applyView('open', 'open', 'none')).toEqual({ kind: 'open' });
    expect(applyView('invite', 'nonmember', 'denied')).toEqual({ kind: 'invite' });
  });
  it('tells members and the forum account they are already in', () => {
    expect(applyView('apply', 'member', 'none')).toEqual({ kind: 'member' });
    expect(applyView('apply', 'exempt', 'none')).toEqual({ kind: 'member' });
    expect(applyView('apply', 'accepted-undeclared', 'pending')).toEqual({ kind: 'accepted' });
  });
  it('holds the form while an application is pending or waiting', () => {
    expect(applyView('apply', 'nonmember', 'pending')).toEqual({ kind: 'pending' });
    expect(applyView('apply', 'nonmember', 'waiting')).toEqual({ kind: 'waiting' });
  });
  it('offers the form to newcomers and again after a denial', () => {
    expect(applyView('apply', 'nonmember', 'none')).toEqual({ kind: 'form', declined: false });
    expect(applyView('apply', 'nonmember', 'denied')).toEqual({ kind: 'form', declined: true });
  });
});

describe('canApply', () => {
  it('allows a write only from the form view', () => {
    expect(canApply('apply', 'nonmember', 'none')).toBe(true);
    expect(canApply('apply', 'nonmember', 'denied')).toBe(true);
    expect(canApply('apply', 'nonmember', 'pending')).toBe(false);
    expect(canApply('apply', 'nonmember', 'waiting')).toBe(false);
    expect(canApply('apply', 'member', 'none')).toBe(false);
    expect(canApply('open', 'open', 'none')).toBe(false);
    expect(canApply('invite', 'nonmember', 'none')).toBe(false);
  });
});

describe('noteTooLong', () => {
  it('counts graphemes rather than UTF-16 code units', () => {
    expect(noteTooLong('a'.repeat(300))).toBe(false);
    expect(noteTooLong('a'.repeat(301))).toBe(true);
    // Each family emoji is one grapheme but many code units.
    expect(noteTooLong('👨‍👩‍👧‍👦'.repeat(300))).toBe(false);
    expect(noteTooLong('👨‍👩‍👧‍👦'.repeat(301))).toBe(true);
  });
});
