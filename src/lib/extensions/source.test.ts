import { describe, expect, it, vi } from 'vitest';
import { createSourceTracker, sourceFromResponse, sourceLine, type SourceIdentity, type SourceState } from './source';

const FORUM = 'did:plc:dvh42fok55dox6pzlyevelz6';
const OTHER = 'did:plc:someoneelse';

const unresolved = (did: string): SourceIdentity => ({ did, handle: null, handleVerified: false, forum: false, unavailable: true });

describe('sourceFromResponse', () => {
  it('takes a well-formed answer for the DID it asked about', () => {
    const body = { did: FORUM, handle: 'atmobb.app', handleVerified: true, forum: true, forumName: 'atmoBB Forums' };
    expect(sourceFromResponse(FORUM, 200, body)).toEqual(body);
    expect(sourceFromResponse(OTHER, 200, { did: OTHER, handle: null, handleVerified: false, forum: false })).toEqual({ did: OTHER, handle: null, handleVerified: false, forum: false });
  });

  it('reads a refusal, a malformed answer, or an answer about another DID as unresolved', () => {
    expect(sourceFromResponse(FORUM, 429, { code: 'rate_limited', message: 'Too many' })).toEqual(unresolved(FORUM));
    expect(sourceFromResponse(FORUM, 200, null)).toEqual(unresolved(FORUM));
    expect(sourceFromResponse(FORUM, 200, { did: FORUM, handle: 7, handleVerified: true, forum: true })).toEqual(unresolved(FORUM));
    expect(sourceFromResponse(FORUM, 200, { did: FORUM, handle: 'atmobb.app', handleVerified: 'yes', forum: true })).toEqual(unresolved(FORUM));
    expect(sourceFromResponse(FORUM, 200, { did: OTHER, handle: 'atmobb.app', handleVerified: true, forum: true })).toEqual(unresolved(FORUM));
  });
});

describe('sourceLine', () => {
  it('names the source by its verified handle, or by its DID when the handle is unverified or missing', () => {
    expect(sourceLine({ did: FORUM, handle: 'atmobb.app', handleVerified: true, forum: true, forumName: 'atmoBB Forums' })).toEqual({
      name: '@atmobb.app',
      did: FORUM,
      forum: true,
      forumName: 'atmoBB Forums',
      checked: true,
    });
    expect(sourceLine({ did: FORUM, handle: 'atmobb.app', handleVerified: false, forum: false })).toMatchObject({ name: FORUM, forum: false, checked: true });
    expect(sourceLine(unresolved(FORUM))).toMatchObject({ name: FORUM, forum: false, checked: false });
  });

  it('never shows a forum name for a DID that is not a forum', () => {
    expect(sourceLine({ did: FORUM, handle: null, handleVerified: false, forum: false, forumName: 'Impostor' }).forumName).toBeUndefined();
  });
});

describe('createSourceTracker', () => {
  function harness(lookup = vi.fn(async (did: string): Promise<SourceIdentity> => ({ did, handle: null, handleVerified: false, forum: did === FORUM }))) {
    const states: SourceState[] = [];
    const tracker = createSourceTracker({ lookup, update: (state) => states.push(state) });
    return { tracker, lookup, states };
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('shows the source as checking, then as checked', async () => {
    const { tracker, states } = harness();
    tracker.set(FORUM);
    expect(states).toEqual([{ status: 'checking', did: FORUM }]);
    await flush();
    expect(states.at(-1)).toEqual({ status: 'checked', identity: { did: FORUM, handle: null, handleVerified: false, forum: true } });
  });

  it('looks a repeated source up only once', async () => {
    const { tracker, lookup } = harness();
    tracker.set(FORUM);
    await flush();
    tracker.set(FORUM);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('lets a later source replace an earlier one, dropping the earlier answer if it lands late', async () => {
    const finishers = new Map<string, (identity: SourceIdentity) => void>();
    const lookup = vi.fn((did: string) => new Promise<SourceIdentity>((resolve) => finishers.set(did, resolve)));
    const { tracker, states } = harness(lookup);
    tracker.set(FORUM);
    tracker.set(OTHER);
    finishers.get(OTHER)!({ did: OTHER, handle: null, handleVerified: false, forum: false });
    await flush();
    finishers.get(FORUM)!({ did: FORUM, handle: 'atmobb.app', handleVerified: true, forum: true });
    await flush();
    expect(states).toEqual([
      { status: 'checking', did: FORUM },
      { status: 'checking', did: OTHER },
      { status: 'checked', identity: { did: OTHER, handle: null, handleVerified: false, forum: false } },
    ]);
  });

  it('shows a failed lookup as unresolved, and nothing after it is closed', async () => {
    const { tracker, states } = harness(vi.fn(async () => Promise.reject(new Error('offline'))));
    tracker.set(FORUM);
    await flush();
    expect(states.at(-1)).toEqual({ status: 'checked', identity: unresolved(FORUM) });

    const closed = harness();
    closed.tracker.set(FORUM);
    closed.tracker.close();
    await flush();
    closed.tracker.set(OTHER);
    expect(closed.states).toEqual([{ status: 'checking', did: FORUM }]);
  });
});
