import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER = 'did:plc:owner';
const OTHER = 'did:plc:other';
const FORUM = 'did:plc:forum';
const BOARD = `at://${FORUM}/app.atmobb.forum.board/general`;
const publicPin = (rkey: string, author = OWNER) => `at://${author}/app.atmobb.discussion.thread/${rkey}`;
const spacePin = (rkey: string, author = OWNER) =>
  `at://${FORUM}/space/app.atmobb.forum.board/secret/${author}/app.atmobb.discussion.thread/${rkey}`;

const state = vi.hoisted(() => ({
  profile: {} as Record<string, unknown> | null,
  standing: { bans: [], warnings: [] } as { bans: { uri: string; board?: string; since: string; until?: string; reason?: string }[]; warnings: unknown[] },
  stamps: { stamps: [], network: [], tray: [], worn: [], pinned: [] } as Record<string, unknown> & { pinned: string[] },
  threads: new Map<string, unknown>(),
  spaceMembers: new Set<string>(),
  spaceThreads: new Map<string, unknown>(),
  threadReads: [] as string[],
  spaceReads: [] as string[],
  activity: { local: {}, global: {}, recentThreads: [] as unknown[] },
  forumHides: false,
}));

vi.mock('$lib/server/admin', () => ({
  canModerate: async () => true,
  canModerateForum: async (did?: string) => did === 'did:plc:staff',
  forumStaff: async () => [],
}));
vi.mock('$lib/server/appview', async (importOriginal) => ({
  parseSpaceUri: (await importOriginal<typeof import('$lib/server/appview')>()).parseSpaceUri,
  spaceUriOf: (await importOriginal<typeof import('$lib/server/appview')>()).spaceUriOf,
  FORUM_DID: () => FORUM,
  getBoardIndex: async () => ({ boards: [{ uri: BOARD, value: { name: 'General' } }] }),
  getMembership: async () => null,
  getStamps: async () => state.stamps,
  getStanding: async () => state.standing,
  resolveHandle: async (did: string) => did,
  getThreadPage: async (uri: string) => {
    state.threadReads.push(uri);
    return state.threads.get(uri) ?? { replies: [], replyCount: 0 };
  },
  isSpaceMember: async (_space: string, did: string) => state.spaceMembers.has(did),
}));
vi.mock('$lib/server/space-read', () => ({
  readSpaceThreadPage: async (viewer: string, uri: string) => {
    state.spaceReads.push(uri);
    return state.spaceMembers.has(viewer) ? (state.spaceThreads.get(uri) ?? { replies: [], replyCount: 0 }) : { replies: [], replyCount: 0 };
  },
}));
vi.mock('$lib/server/forum-repo', () => ({ createForumRecord: vi.fn() }));
vi.mock('$lib/server/saved-redirect', () => ({ savedRedirect: vi.fn() }));
vi.mock('$lib/server/space-access', () => ({ revokeSpaceAccess: vi.fn() }));
vi.mock('$lib/server/richtext', () => ({ resolveBodyImages: async () => {} }));
vi.mock('$lib/server/profiles', () => ({
  resolveActor: async () => ({ did: OWNER, handle: 'owner.test', pds: 'https://pds.test' }),
  getPublicProfile: async () => state.profile,
  getBskyProfile: async () => ({ handle: 'owner.test' }),
  getAtmobbActivity: async () => state.activity,
  getElsewhere: async () => ({ bsky: null, apps: [], posts: [] }),
  presenceFor: () => 'offline',
}));

import { load } from './+page.server';
import { GET as card } from './card.json/+server';

const thread = (uri: string, title: string, extra: Record<string, unknown> = {}) => ({
  thread: {
    uri, cid: 'cid', author: OWNER, authorStamps: [], hidden: false, locked: false, pinned: false,
    value: { title, board: BOARD, createdAt: '2026-09-14T00:00:00Z' }, ...extra,
  },
  replies: [],
  replyCount: 4,
});

type Viewer = 'owner' | 'staff' | 'member' | 'anon';
async function view(viewer: Viewer, query = '') {
  const did = { owner: OWNER, staff: 'did:plc:staff', member: OTHER, anon: null }[viewer];
  const url = new URL(`http://localhost/members/owner.test${query}`);
  const parent = async () => ({
    forum: { name: 'Forum', ...(state.forumHides ? { hideProfileSkins: true } : {}) },
    forumDid: FORUM,
    staffRole: viewer === 'staff' ? 'admin' : null,
    sidebarBoards: [{ uri: BOARD, value: { name: 'General' } }],
  });
  // load's return type is a union with void; every path here returns data.
  return (await load({ params: { actor: 'owner.test' }, locals: { user: did ? { did, handle: 'x' } : null }, parent, url } as never)) as Record<string, any>;
}

beforeEach(() => {
  state.profile = {
    displayName: 'Owner',
    profileSkin: 'midnight',
    banner: { pattern: 'stars', swatch: 'navy' },
    headline: 'building forums',
    currently: 'rewriting URLs',
    about: [{ $type: 'app.atmobb.richtext.block#text', text: 'Hello there' }],
    panels: [],
    forumProfiles: [{ forum: FORUM, fields: [] }],
    forumThemes: [{ forum: FORUM, theme: 'sky' }],
    notifications: true,
  };
  state.standing = { bans: [], warnings: [] };
  state.stamps = {
    stamps: [], network: [],
    tray: [
      { id: 'atmobb:first-light', name: 'first light', source: 'network' },
      { id: 'atmobb:early-days', name: 'early days', source: 'network' },
    ],
    worn: ['atmobb:early-days'],
    pinned: [],
  };
  state.threads = new Map();
  state.spaceMembers = new Set();
  state.spaceThreads = new Map();
  state.threadReads = [];
  state.spaceReads = [];
  state.activity = {
    local: {}, global: {},
    recentThreads: [{ uri: publicPin('r1'), board: BOARD, boardName: 'General', title: 'Recent', createdAt: '2026-09-14T00:00:00Z', replyCount: 1, forum: { did: FORUM } }],
  };
  state.forumHides = false;
});

describe('plain mode for a banned owner', () => {
  it('shows a logged-out visitor a forum-banned owner plainly, keeping activity and the shelf', async () => {
    state.standing = { bans: [{ uri: 'at://ban/1', since: '2026-09-01T00:00:00Z', reason: 'spam' }], warnings: [] };
    const data = await view('anon');
    expect(data.look).toEqual({ style: undefined, banner: null, plain: true });
    expect(data.member.profile.about).toBeUndefined();
    expect(data.member.profile.headline).toBeUndefined();
    expect(data.member.profile.currently).toBeUndefined();
    const ids = data.panels.panels.map((p: { id: string }) => p.id);
    expect(ids).not.toContain('about');
    expect(ids).toContain('activity');
    expect(ids).toContain('stamps');
    expect(data.shelf.map((e: { id: string }) => e.id)).toEqual(['atmobb:early-days', 'atmobb:first-light']);
  });

  it('keeps the page skinned when the only ban is board-scoped', async () => {
    state.standing = { bans: [{ uri: 'at://ban/1', board: BOARD, since: '2026-09-01T00:00:00Z' }], warnings: [] };
    const data = await view('anon');
    expect(data.look.plain).toBe(false);
    expect(data.look.style).toBeTruthy();
    expect(data.look.banner).not.toBeNull();
    expect(data.panels.panels.map((p: { id: string }) => p.id)).toContain('about');
  });

  it('never hands standing details to a visitor', async () => {
    state.standing = { bans: [{ uri: 'at://ban/1', since: '2026-09-01T00:00:00Z', reason: 'spam' }], warnings: [{ uri: 'w' }] };
    const data = await view('member');
    expect(data.standing).toBeNull();
    expect(JSON.stringify(data)).not.toContain('spam');
    expect(data.notices).toBeNull();
  });

  it('tells the banned owner their page is shown plain', async () => {
    state.standing = { bans: [{ uri: 'at://ban/1', since: '2026-09-01T00:00:00Z' }], warnings: [] };
    const data = await view('owner');
    expect(data.notices).toMatchObject({ plain: true });
    expect(data.standing).not.toBeNull();
  });
});

describe('pinned topics', () => {
  it('drops a pin the visitor cannot read and marks it restricted for the owner', async () => {
    const secret = spacePin('s1');
    const open = publicPin('p1');
    state.stamps.pinned = [secret, open];
    state.spaceMembers.add(OWNER);
    state.spaceThreads.set(secret, thread(secret, 'Secret plans'));
    state.threads.set(open, thread(open, 'Open topic'));

    const visitor = await view('member');
    expect(visitor.pins.map((p: { uri: string }) => p.uri)).toEqual([open]);

    const owner = await view('owner');
    expect(owner.pins).toEqual([
      expect.objectContaining({ uri: secret, title: 'Secret plans', note: 'restricted' }),
      expect.objectContaining({ uri: open, title: 'Open topic', note: null, boardName: 'General', replyCount: 4 }),
    ]);
  });

  it('drops a deleted pin for everyone and flags it for the owner', async () => {
    const gone = publicPin('gone');
    state.stamps.pinned = [gone];
    expect((await view('anon')).pins).toEqual([]);
    expect((await view('owner')).pins).toEqual([expect.objectContaining({ uri: gone, note: 'gone' })]);
  });

  it('reads at most four pins and never one another member wrote', async () => {
    const foreign = publicPin('theirs', OTHER);
    const foreignSpace = spacePin('theirs', OTHER);
    state.stamps.pinned = [
      publicPin('a'), foreign, foreignSpace, publicPin('b'), publicPin('c'), publicPin('d'),
      publicPin('e'), publicPin('f'), publicPin('g'), publicPin('h'),
    ];
    await view('member');
    expect(state.threadReads.length + state.spaceReads.length).toBeLessThanOrEqual(4);
    expect(state.threadReads).not.toContain(foreign);
    expect(state.spaceReads).not.toContain(foreignSpace);
  });
});

describe('visitor preview', () => {
  it('lets the owner preview as a visitor: no Standing, prompts, or stubs', async () => {
    state.profile = { displayName: 'Owner', panels: [{ id: 'signature', hidden: true }] };
    const editing = await view('owner');
    expect(editing.standing).not.toBeNull();
    expect(editing.panels.panels.some((p: { state: string }) => p.state !== 'content')).toBe(true);

    const preview = await view('owner', '?as=visitor');
    expect(preview.preview).toBe(true);
    expect(preview.isYou).toBe(false);
    expect(preview.standing).toBeNull();
    expect(preview.panels.panels.every((p: { state: string }) => p.state === 'content')).toBe(true);
  });

  it('changes nothing when someone else asks for it', async () => {
    const staff = await view('staff', '?as=visitor');
    expect(staff.preview).toBe(false);
    expect(staff.standing).not.toBeNull();
    expect(staff.stampsByHand).not.toBeNull();
    const member = await view('member', '?as=visitor');
    expect(member.preview).toBe(false);
  });
});

describe('staff tools', () => {
  it('gives staff the boards and stamp controls, and a visitor none', async () => {
    const staff = await view('staff');
    expect(staff.standing).not.toBeNull();
    expect(staff.boards).toEqual([{ uri: BOARD, name: 'General' }]);
    expect(staff.stampsByHand).toEqual([]);
    const visitor = await view('member');
    expect(visitor.standing).toBeNull();
    expect(visitor.boards).toEqual([]);
    expect(visitor.stampsByHand).toBeNull();
  });
});

describe('forum skins switch', () => {
  it('drops the owner skin and tells the owner why', async () => {
    state.forumHides = true;
    const owner = await view('owner');
    expect(owner.look.style).toBeUndefined();
    expect(owner.notices).toMatchObject({ skinsOff: true });
    const visitor = await view('anon');
    expect(visitor.look.style).toBeUndefined();
    expect(visitor.notices).toBeNull();
  });
});

describe('card.json', () => {
  it('carries only what the hovercard draws', async () => {
    const res = await card({ params: { actor: 'owner.test' }, locals: { user: null } } as never);
    const body = await res.json();
    for (const key of ['about', 'panels', 'forumProfiles', 'forumThemes', 'notifications', 'headline']) {
      expect(JSON.stringify(body)).not.toContain(`"${key}"`);
    }
    expect(body).toMatchObject({ did: OWNER, displayName: 'Owner', bsky: { handle: 'owner.test' } });
  });
});
