import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blocksToDoc } from '$lib/richtext/blocks-tiptap';
import { docToBBCode } from '$lib/richtext/tiptap-bbcode';
import { parseBBCode } from '$lib/richtext/bbcode';

const FORUM = 'did:plc:current';
const MEMBER = 'did:plc:member';
const THREAD = 'app.atmobb.discussion.thread';
const MEMBERSHIP = 'app.atmobb.forum.membership';

const state = vi.hoisted(() => ({
  save: vi.fn(),
  setPinned: vi.fn(),
  profile: {} as Record<string, unknown>,
  pinned: [] as string[],
  threads: [] as { uri: string; value: Record<string, unknown> }[],
}));
vi.mock('$lib/server/pds', () => ({
  MAX_PINS: 4,
  getActorProfile: async () => state.profile,
  saveProfile: state.save,
  setPinned: state.setPinned,
}));
vi.mock('$lib/server/atproto-oauth', () => ({
  agentFor: async () => ({
    com: {
      atproto: {
        repo: {
          listRecords: async ({ collection }: { collection: string }) => ({
            data: {
              records: collection === MEMBERSHIP
                ? [{ uri: `at://${MEMBER}/${MEMBERSHIP}/self`, value: { forum: FORUM, pinned: state.pinned } }]
                : collection === THREAD ? state.threads : [],
            },
          }),
        },
      },
    },
  }),
}));
vi.mock('$lib/server/profiles', () => ({ blobUrl: async () => null, bustProfileCache: vi.fn() }));
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => FORUM,
  getBoardIndex: async () => ({
    boards: [{ uri: `at://${FORUM}/app.atmobb.forum.board/general`, value: { name: 'General' }, threadCount: 0, replyCount: 0 }],
  }),
  listSpaceRecords: async () => [],
  getSpaceRecord: async () => { throw new Error('no space records in these tests'); },
  spaceOfBoard: (access?: { space?: string }) => access?.space ?? null,
}));
import { actions, load } from './+page.server';

const user = { did: MEMBER, handle: 'member.test' };
const ALL_PANELS = ['about', 'pinned', 'stamps', 'activity', 'bluesky', 'signature'];
const topic = (rkey: string) => `at://${MEMBER}/${THREAD}/${rkey}`;

function event(action: string, scope: string, values: [string, string][] = [], authenticated = true) {
  const url = new URL(`http://localhost/settings/page?/${action}&scope=${scope}`);
  return {
    locals: { user: authenticated ? user : null },
    url,
    request: new Request(url, { method: 'POST', body: new URLSearchParams(values) }),
  } as never;
}

/** A complete, valid post of the form, with overrides appended. */
function fields(extra: [string, string][] = [], panels = ALL_PANELS): [string, string][] {
  const replaced = new Set(extra.map(([name]) => name).filter((name) => !['pin', 'inherit', 'panel', 'show'].includes(name)));
  const base: [string, string][] = [
    ['profileSkin', 'midnight'],
    ['bannerPattern', 'stars'],
    ['bannerSwatch', 'navy'],
    ['headline', 'building forums'],
    ['currently', 'reading'],
    ['about', 'Hello [b]there[/b]'],
    ...panels.map((id): [string, string] => ['panel', id]),
    ...panels.map((id): [string, string] => ['show', id]),
    ['pinsShown', '1'],
  ];
  return [...base.filter(([name]) => !replaced.has(name)), ...extra];
}

beforeEach(() => {
  state.save.mockReset();
  state.setPinned.mockReset();
  state.profile = { headline: 'Account headline', forumProfiles: [{ forum: FORUM, fields: ['headline'], headline: 'Forum headline' }] };
  state.pinned = [];
  state.threads = [];
});

describe('profile page editor: load', () => {
  it('sends a logged-out visitor to log in', async () => {
    await expect(load(event('save', 'forum', [], false))).rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('loads the forum override and lists only own topics on this forum, pinned ones first', async () => {
    state.pinned = [topic('b')];
    state.threads = [
      { uri: topic('a'), value: { title: 'Here A', board: `at://${FORUM}/app.atmobb.forum.board/general`, createdAt: '2026-01-02T00:00:00Z' } },
      { uri: topic('b'), value: { title: 'Here B', board: `at://${FORUM}/app.atmobb.forum.board/general`, createdAt: '2026-01-01T00:00:00Z' } },
      { uri: topic('c'), value: { title: 'Elsewhere', board: 'at://did:plc:other/app.atmobb.forum.board/x', createdAt: '2026-01-03T00:00:00Z' } },
    ];
    const data = await load(event('save', 'forum')) as Record<string, any>;
    expect(data.values).toMatchObject({ headline: 'Forum headline', pins: [topic('b')] });
    expect(data.values.panels.map((p: { id: string }) => p.id)).toEqual(ALL_PANELS);
    expect(data.topics.map((t: { title: string; board: string }) => [t.title, t.board])).toEqual([['Here A', 'General'], ['Here B', 'General']]);
  });
});

describe('profile page editor: save', () => {
  it('rejects a headline over 80 graphemes and saves nothing', async () => {
    const result = await actions.save!(event('save', 'all', fields([['headline', '👍🏽'.repeat(81)]])));
    expect(result).toMatchObject({ status: 400, data: { errors: { headline: expect.any(String) } } });
    expect(state.save).not.toHaveBeenCalled();
    expect(state.setPinned).not.toHaveBeenCalled();
  });

  it('accepts a headline of exactly 80 graphemes', async () => {
    await actions.save!(event('save', 'all', fields([['headline', '👍🏽'.repeat(80)]])));
    expect(state.save).toHaveBeenCalledWith(MEMBER, expect.objectContaining({ headline: '👍🏽'.repeat(80) }), undefined, []);
  });

  it('rejects an unknown banner pattern or swatch', async () => {
    expect(await actions.save!(event('save', 'all', fields([['bannerPattern', 'zigzag']])))).toMatchObject({ status: 400 });
    expect(await actions.save!(event('save', 'all', fields([['bannerSwatch', 'chartreuse']])))).toMatchObject({ status: 400 });
    expect(await actions.save!(event('save', 'all', fields([['profileSkin', 'neon']])))).toMatchObject({ status: 400 });
    expect(state.save).not.toHaveBeenCalled();
  });

  it('rejects a panel order with an unknown id or a duplicate', async () => {
    const unknown = await actions.save!(event('save', 'all', fields([], [...ALL_PANELS, 'guestbook'])));
    expect(unknown).toMatchObject({ status: 400, data: { errors: { panels: expect.any(String) } } });
    const duplicate = await actions.save!(event('save', 'all', fields([], [...ALL_PANELS, 'about'])));
    expect(duplicate).toMatchObject({ status: 400, data: { errors: { panels: expect.any(String) } } });
    const missing = await actions.save!(event('save', 'all', fields([], ALL_PANELS.slice(1))));
    expect(missing).toMatchObject({ status: 400 });
    expect(state.save).not.toHaveBeenCalled();
  });

  it('saves an unchecked panel as hidden in its place', async () => {
    const order = ['pinned', 'about', 'stamps', 'activity', 'bluesky', 'signature'];
    const posted = fields([], order).filter(([name, value]) => !(name === 'show' && value === 'stamps'));
    await actions.save!(event('save', 'all', posted));
    expect(state.save.mock.calls[0][1].panels).toEqual([
      { id: 'pinned' }, { id: 'about' }, { id: 'stamps', hidden: true }, { id: 'activity' }, { id: 'bluesky' }, { id: 'signature' },
    ]);
  });

  it('clears the saved order when it matches the default with every panel shown', async () => {
    await actions.save!(event('save', 'all', fields()));
    expect(state.save.mock.calls[0][1].panels).toEqual([]);
  });

  it('saves the same About me from the no-script BBCode box as from the editor', async () => {
    await actions.save!(event('save', 'all', fields([['about', '[b]Hi[/b] there\n\nSecond paragraph']])));
    const fromTextarea = state.save.mock.calls[0][1].about;
    const editorBBCode = docToBBCode(blocksToDoc(fromTextarea));
    await actions.save!(event('save', 'all', fields([['about', editorBBCode], ['about__images', '{}']])));
    expect(state.save.mock.calls[1][1].about).toEqual(fromTextarea);
    expect(fromTextarea).toHaveLength(2);
  });

  it('drops an inherited skin from the forum override and leaves it out of the edit', async () => {
    await actions.save!(event('save', 'forum', fields([['inherit', 'profileSkin']])));
    const [did, edit, forum, inherit] = state.save.mock.calls[0];
    expect([did, forum]).toEqual([MEMBER, FORUM]);
    expect(edit).not.toHaveProperty('profileSkin');
    expect(edit).toMatchObject({ headline: 'building forums', banner: { pattern: 'stars', swatch: 'navy' } });
    expect(inherit).toEqual(['profileSkin']);
  });

  it('skips validating a field that inherits the account default', async () => {
    await actions.save!(event('save', 'forum', fields([['headline', 'x'.repeat(200)], ['inherit', 'headline']])));
    expect(state.save).toHaveBeenCalled();
  });

  it('pins the checked topics in posted order, before saving the profile', async () => {
    state.setPinned.mockImplementation(async () => expect(state.save).not.toHaveBeenCalled());
    await actions.save!(event('save', 'all', fields([['pin', topic('b')], ['pin', topic('a')]])));
    expect(state.setPinned).toHaveBeenCalledWith(MEMBER, FORUM, [topic('b'), topic('a')]);
    expect(state.save).toHaveBeenCalled();
  });

  it('leaves pins alone when they did not change', async () => {
    state.pinned = [topic('a')];
    await actions.save!(event('save', 'all', fields([['pin', topic('a')]])));
    expect(state.setPinned).not.toHaveBeenCalled();
    expect(state.save).toHaveBeenCalled();
  });

  it('turns a pinning error into a form error and saves nothing else', async () => {
    state.setPinned.mockRejectedValue(new Error('You can only pin your own topics.'));
    const result = await actions.save!(event('save', 'all', fields([['pin', topic('a')]])));
    expect(result).toMatchObject({ status: 400, data: { errors: { pins: 'You can only pin your own topics.' } } });
    expect(state.save).not.toHaveBeenCalled();
  });

  it('rejects more than four pins before writing anything', async () => {
    const result = await actions.save!(event('save', 'all', fields(['a', 'b', 'c', 'd', 'e'].map((k): [string, string] => ['pin', topic(k)]))));
    expect(result).toMatchObject({ status: 400, data: { errors: { pins: expect.any(String) } } });
    expect(state.setPinned).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it('rejects a bad scope and a logged-out save', async () => {
    expect(await actions.save!(event('save', 'wrong', fields()))).toMatchObject({ status: 400 });
    expect(await actions.save!(event('save', 'forum', fields(), false))).toMatchObject({ status: 401 });
    expect(state.save).not.toHaveBeenCalled();
  });
});

describe('profile page editor: move', () => {
  it('leaves the order alone moving the first panel up or the last panel down', async () => {
    const up = await actions.move!(event('move', 'all', fields([['move', 'panel:up:about']]))) as Record<string, any>;
    expect(up.values.panels.map((p: { id: string }) => p.id)).toEqual(ALL_PANELS);
    const down = await actions.move!(event('move', 'all', fields([['move', 'panel:down:signature']]))) as Record<string, any>;
    expect(down.values.panels.map((p: { id: string }) => p.id)).toEqual(ALL_PANELS);
  });

  it('moves a panel and keeps the unsaved headline, About me and hidden flags', async () => {
    const posted = fields([['headline', 'half-written'], ['about', 'Draft [i]about[/i]'], ['move', 'panel:down:about']])
      .filter(([name, value]) => !(name === 'show' && value === 'bluesky'));
    const result = await actions.move!(event('move', 'all', posted)) as Record<string, any>;
    expect(result.values.panels).toEqual([
      { id: 'pinned', hidden: false }, { id: 'about', hidden: false }, { id: 'stamps', hidden: false },
      { id: 'activity', hidden: false }, { id: 'bluesky', hidden: true }, { id: 'signature', hidden: false },
    ]);
    expect(result.values).toMatchObject({ headline: 'half-written', about: 'Draft [i]about[/i]', profileSkin: 'midnight' });
    expect(result.values.aboutDoc).toEqual(blocksToDoc(parseBBCode('Draft [i]about[/i]')));
    expect(state.save).not.toHaveBeenCalled();
  });

  it('moves a pinned topic among the pinned ones', async () => {
    const result = await actions.move!(event('move', 'all', fields([['pin', topic('a')], ['pin', topic('b')], ['move', `pin:up:${topic('b')}`]]))) as Record<string, any>;
    expect(result.values.pins).toEqual([topic('b'), topic('a')]);
    expect(state.setPinned).not.toHaveBeenCalled();
  });
});
