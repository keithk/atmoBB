import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER = 'did:plc:owner';
const SIGNER = 'did:plc:signer';
const STAFF = 'did:plc:staff';
const FORUM = 'did:plc:forum';
const GB = 'app.atmobb.actor.guestbook';
const entryUri = (rkey: string, author = SIGNER) => `at://${author}/${GB}/${rkey}`;

const state = vi.hoisted(() => ({
  guestbook: { entries: [] as Record<string, unknown>[], open: true, viewerBlocked: false },
  guestbookAsked: [] as unknown[],
  banned: false,
  memberRefusal: null as unknown,
  lastSigned: null as string | null,
  sign: vi.fn(),
  remove: vi.fn(),
  hide: vi.fn(),
  unhide: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  forumRecord: vi.fn(),
}));

vi.mock('$lib/server/admin', () => ({
  canModerate: async () => false,
  canModerateForum: async (did?: string) => did === 'did:plc:staff',
  forumStaff: async () => [],
}));
vi.mock('$lib/server/appview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/appview')>()),
  FORUM_DID: () => FORUM,
  getGuestbook: async (...args: unknown[]) => {
    state.guestbookAsked.push(args);
    return state.guestbook;
  },
  // One read: whatever the fake index holds now decides whether the write landed.
  awaitIndexed: async <T>(read: () => Promise<T>, landed: (data: T) => boolean) => landed(await read()),
  resolveHandle: async (did: string) => `${did.split(':').pop()}.test`,
}));
vi.mock('$lib/server/pds', () => ({
  signGuestbook: state.sign,
  deleteGuestbookEntry: state.remove,
  lastGuestbookEntryAt: async () => state.lastSigned,
  hideGuestbookEntry: state.hide,
  unhideGuestbookEntry: state.unhide,
  blockGuestbookSigner: state.block,
  unblockGuestbookSigner: state.unblock,
}));
vi.mock('$lib/server/standing', () => ({
  bannedFrom: async () => (state.banned ? { uri: 'ban', since: '2026-01-01T00:00:00Z', reason: 'secret reason' } : undefined),
}));
vi.mock('$lib/server/membership', () => ({ refuseUnlessMember: async () => state.memberRefusal }));
vi.mock('$lib/server/forum-repo', () => ({
  createForumRecord: state.forumRecord,
  forumWriteErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('$lib/server/space-read', () => ({ readSpaceThreadPage: vi.fn() }));
vi.mock('$lib/server/saved-redirect', () => ({ savedRedirect: vi.fn() }));
vi.mock('$lib/server/space-access', () => ({ revokeSpaceAccess: vi.fn() }));
vi.mock('$lib/server/richtext', () => ({ resolveBodyImages: async () => {} }));
vi.mock('$lib/server/profiles', () => ({
  resolveActor: async () => ({ did: OWNER, handle: 'owner.test', pds: 'https://pds.test' }),
  getPublicProfile: async () => null,
  getAtmobbActivity: async () => ({ local: {}, global: {}, recentThreads: [] }),
  getElsewhere: async () => ({ bsky: null, apps: [], posts: [] }),
  presenceFor: () => 'offline',
}));

import { actions } from './+page.server';

function event(viewer: string | null, fields: Record<string, string> = {}, query = '') {
  const url = new URL(`http://localhost/members/owner.test${query}`);
  return {
    params: { actor: 'owner.test' },
    locals: { user: viewer ? { did: viewer, handle: 'viewer.test' } : null },
    url,
    request: new Request(url, { method: 'POST', body: new URLSearchParams(fields) }),
  } as never;
}

/** Run an action, returning its result or the redirect it threw. */
async function run(name: keyof typeof actions, viewer: string | null, fields: Record<string, string> = {}, query = '') {
  try {
    return await actions[name]!(event(viewer, fields, query));
  } catch (thrown) {
    if ((thrown as { status?: number }).status === 303) return thrown as { status: number; location: string };
    throw thrown;
  }
}

const NEUTRAL = "You can't sign this guestbook.";

beforeEach(() => {
  state.guestbook = { entries: [], open: true, viewerBlocked: false };
  state.guestbookAsked = [];
  state.banned = false;
  state.memberRefusal = null;
  state.lastSigned = null;
  for (const fn of [state.sign, state.remove, state.hide, state.unhide, state.block, state.unblock, state.forumRecord]) fn.mockReset();
  state.sign.mockImplementation(async () => {
    const uri = entryUri('new');
    state.guestbook.entries.push({ uri, cid: 'c', author: SIGNER, text: 'hi', createdAt: '', indexedAt: '' });
    return { uri, cid: 'c' };
  });
});

describe('signing', () => {
  it('writes an entry naming this forum and the owner, then lands on the guestbook', async () => {
    const result = await run('sign', SIGNER, { text: '  hello there  ' });
    expect(state.sign).toHaveBeenCalledWith(SIGNER, FORUM, OWNER, 'hello there');
    expect(result).toMatchObject({ status: 303, location: '/members/owner.test#panel-guestbook' });
  });

  it('says the write is on its way when the index has not caught up', async () => {
    state.sign.mockResolvedValue({ uri: entryUri('slow'), cid: 'c' });
    expect(await run('sign', SIGNER, { text: 'hello' })).toMatchObject({ location: '/members/owner.test?pending=1#panel-guestbook' });
  });

  it('refuses an empty note and one over 300 characters, keeping the text', async () => {
    expect(await run('sign', SIGNER, { text: '   ' })).toMatchObject({ status: 400 });
    const long = '👍🏽'.repeat(301);
    expect(await run('sign', SIGNER, { text: long })).toMatchObject({ status: 400, data: { guestbookText: long } });
    expect(state.sign).not.toHaveBeenCalled();
    await run('sign', SIGNER, { text: '👍🏽'.repeat(300) });
    expect(state.sign).toHaveBeenCalled();
  });

  it('gives the same neutral refusal for a closed guestbook, a block, a ban, and a gated non-member', async () => {
    const refusals: unknown[] = [];
    state.guestbook.open = false;
    refusals.push(await run('sign', SIGNER, { text: 'hi' }));
    state.guestbook = { entries: [], open: true, viewerBlocked: true };
    refusals.push(await run('sign', SIGNER, { text: 'hi' }));
    state.guestbook.viewerBlocked = false;
    state.banned = true;
    refusals.push(await run('sign', SIGNER, { text: 'hi' }));
    state.banned = false;
    state.memberRefusal = { status: 403, data: { message: 'Only members can post here. Apply to join first.' } };
    refusals.push(await run('sign', SIGNER, { text: 'hi' }));
    for (const refusal of refusals) expect(refusal).toMatchObject({ status: 403, data: { guestbookError: NEUTRAL } });
    expect(JSON.stringify(refusals)).not.toMatch(/secret reason|Apply/);
    expect(state.sign).not.toHaveBeenCalled();
  });

  it('asks the index about this signer', async () => {
    await run('sign', SIGNER, { text: 'hi' });
    expect(state.guestbookAsked[0]).toEqual([FORUM, OWNER, expect.objectContaining({ viewer: SIGNER })]);
  });

  it('refuses the owner signing their own guestbook', async () => {
    expect(await run('sign', OWNER, { text: 'hi' })).toMatchObject({ status: 400 });
    expect(state.sign).not.toHaveBeenCalled();
  });

  it('says when the signer can sign again after signing in the last day', async () => {
    state.lastSigned = new Date(Date.now() - 20.5 * 3_600_000).toISOString();
    expect(await run('sign', SIGNER, { text: 'hi' })).toMatchObject({
      status: 429, data: { guestbookError: 'You can sign again in 4 hours.' },
    });
    state.lastSigned = new Date(Date.now() - 23.5 * 3_600_000).toISOString();
    expect(await run('sign', SIGNER, { text: 'hi' })).toMatchObject({ data: { guestbookError: 'You can sign again in 1 hour.' } });
    expect(state.sign).not.toHaveBeenCalled();
    state.lastSigned = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await run('sign', SIGNER, { text: 'hi' });
    expect(state.sign).toHaveBeenCalled();
  });

  it('sends a logged-out visitor to log in, coming back to the profile', async () => {
    expect(await run('sign', null, { text: 'hi' })).toMatchObject({
      status: 303, location: `/login?next=${encodeURIComponent('/members/owner.test')}`,
    });
  });

  it('sends a session without the guestbook grant to log in again once, then explains', async () => {
    state.sign.mockRejectedValue(new Error('Missing required scope "repo:app.atmobb.actor.guestbook"'));
    expect(await run('sign', SIGNER, { text: 'hi' })).toMatchObject({
      status: 303, location: `/login?next=${encodeURIComponent('/members/owner.test?reconsented=1')}`,
    });
    expect(await run('sign', SIGNER, { text: 'hi' }, '?reconsented=1')).toMatchObject({
      status: 409, data: { guestbookError: expect.stringMatching(/propagating/) },
    });
    expect(await run('sign', SIGNER, { text: 'hi', reconsented: '1' })).toMatchObject({ status: 409 });
  });

  it('reports any other write failure without a login loop', async () => {
    state.sign.mockRejectedValue(new Error('PDS unreachable'));
    expect(await run('sign', SIGNER, { text: 'hi' })).toMatchObject({ status: 502, data: { guestbookText: 'hi' } });
  });
});

describe('taking a note back', () => {
  it('refuses someone else\'s entry and deletes one\'s own', async () => {
    const theirs = entryUri('e1', 'did:plc:someone');
    state.remove.mockImplementation(async (did: string, uri: string) => {
      if (!uri.startsWith(`at://${did}/`)) throw new Error('not your guestbook entry');
    });
    expect(await run('delete', SIGNER, { uri: theirs })).toMatchObject({ status: 403 });
    const mine = entryUri('e2');
    expect(await run('delete', SIGNER, { uri: mine })).toMatchObject({ status: 303, location: '/members/owner.test#panel-guestbook' });
    expect(state.remove).toHaveBeenCalledWith(SIGNER, mine);
    expect(await run('delete', null, { uri: mine })).toMatchObject({ status: 401 });
  });
});

describe('owner controls', () => {
  const uri = entryUri('e1');

  it('lets only the owner hide, unhide, block and unblock', async () => {
    for (const name of ['ownerHide', 'ownerUnhide', 'block', 'unblock'] as const) {
      expect(await run(name, SIGNER, { uri, did: SIGNER, confirm: '1' })).toMatchObject({ status: 403 });
      expect(await run(name, STAFF, { uri, did: SIGNER, confirm: '1' })).toMatchObject({ status: 403 });
    }
    expect(state.hide).not.toHaveBeenCalled();
    expect(state.block).not.toHaveBeenCalled();

    expect(await run('ownerHide', OWNER, { uri })).toMatchObject({ status: 303 });
    expect(state.hide).toHaveBeenCalledWith(OWNER, FORUM, uri);
    await run('ownerUnhide', OWNER, { uri });
    expect(state.unhide).toHaveBeenCalledWith(OWNER, FORUM, uri);
    await run('unblock', OWNER, { did: SIGNER });
    expect(state.unblock).toHaveBeenCalledWith(OWNER, FORUM, SIGNER);
  });

  it('refuses hiding something that is not a guestbook entry', async () => {
    expect(await run('ownerHide', OWNER, { uri: `at://${SIGNER}/app.atmobb.discussion.reply/r1` })).toMatchObject({ status: 400 });
    expect(state.hide).not.toHaveBeenCalled();
  });

  it('asks before blocking, and blocks on confirm', async () => {
    expect(await run('block', OWNER, { did: SIGNER })).toEqual({ guestbookBlock: { did: SIGNER, handle: 'signer.test' } });
    expect(state.block).not.toHaveBeenCalled();
    expect(await run('block', OWNER, { did: SIGNER, confirm: '1' })).toMatchObject({ status: 303 });
    expect(state.block).toHaveBeenCalledWith(OWNER, FORUM, SIGNER);
  });
});

describe('staff hides', () => {
  const uri = entryUri('e1');

  it('lets only forum-wide staff hide, writing a moderation action on the entry', async () => {
    expect(await run('staffHide', OWNER, { uri, cid: 'bafy' })).toMatchObject({ status: 403 });
    expect(await run('staffHide', SIGNER, { uri, cid: 'bafy' })).toMatchObject({ status: 403 });
    expect(state.forumRecord).not.toHaveBeenCalled();

    expect(await run('staffHide', STAFF, { uri, cid: 'bafy' })).toMatchObject({ status: 303 });
    expect(state.forumRecord).toHaveBeenCalledWith('app.atmobb.moderation.action', {
      subject: { $type: 'com.atproto.repo.strongRef', uri, cid: 'bafy' },
      action: 'hide',
    });
    await run('staffUnhide', STAFF, { uri, cid: 'bafy' });
    expect(state.forumRecord).toHaveBeenLastCalledWith('app.atmobb.moderation.action', expect.objectContaining({ action: 'unhide' }));
  });

  it('needs a guestbook entry and its cid', async () => {
    expect(await run('staffHide', STAFF, { uri })).toMatchObject({ status: 400 });
    expect(await run('staffHide', STAFF, { uri: `at://${SIGNER}/app.atmobb.discussion.thread/t1`, cid: 'bafy' })).toMatchObject({ status: 400 });
    expect(state.forumRecord).not.toHaveBeenCalled();
  });
});
