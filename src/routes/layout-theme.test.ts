import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ theme: undefined as unknown, forumThemes: undefined as unknown }));
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => 'did:plc:forum',
  getBoardIndex: async () => ({ boards: [], forum: { name: 'Forum', theme: 'midnight', customCss: ':root{color:red}' } }),
  getStanding: async () => null,
}));
vi.mock('$lib/server/pds', () => ({ getMembership: async () => null, getOwnAvatarProfile: async () => ({ theme: state.theme, forumThemes: state.forumThemes }) }));
vi.mock('$lib/server/admin', () => ({ staffRole: async () => null, forumUnclaimed: async () => false }));
vi.mock('$lib/server/webring', () => ({ ringForums: async () => [] }));
vi.mock('$lib/server/profiles', () => ({ blobCid: () => null, blobUrl: async () => null }));
vi.mock('$lib/server/notify/store', () => ({ readMember: async () => null, countUnread: () => 0 }));
vi.mock('$lib/server/membership', () => ({ forumStanding: async () => ({ mode: 'open', standing: 'open' }) }));
import { load } from './+layout.server';

beforeEach(() => { state.forumThemes = undefined; });

const run = (user: { did: string } | null, search = '') =>
  load({ locals: { user }, route: { id: '/' }, url: new URL(`https://forum.example/${search}`) } as never);
const member = { did: 'did:plc:user' };

describe('personal theme precedence', () => {
  it('keeps the forum theme and owner CSS when this forum opts out of the account theme', async () => {
    state.theme = 'sky';
    state.forumThemes = [{ forum: 'did:plc:forum', theme: '' }];
    expect(await run(member)).toMatchObject({ forumTheme: 'midnight', forumCustomCss: ':root{color:red}' });
  });
  it.each([['coral', 'coral'], ['arcade', 'arcade'], ['sky', 'atmosphere']])('shows personal %s as %s and leaves the owner CSS out', async (stored, theme) => {
    state.theme = stored;
    expect(await run(member)).toMatchObject({ forumTheme: theme, forumCustomCss: '', forumFontCss: '' });
  });
  it.each([undefined, 'unknown', 42])('keeps forum styling for invalid or absent preference %s', async (theme) => {
    state.theme = theme;
    expect(await run(member)).toMatchObject({ forumTheme: 'midnight', forumCustomCss: ':root{color:red}' });
  });
  it('keeps forum styling for guests', async () => {
    state.theme = 'arcade';
    expect(await run(null)).toMatchObject({ forumTheme: 'midnight', forumCustomCss: ':root{color:red}' });
  });
});

describe('theme preview', () => {
  it('shows the named theme with the owner CSS, whatever the visitor prefers', async () => {
    state.theme = 'arcade';
    expect(await run(member, '?previewTheme=bulletin')).toMatchObject({ forumTheme: 'bulletin', forumCustomCss: ':root{color:red}' });
    expect(await run(null, '?previewTheme=bulletin')).toMatchObject({ forumTheme: 'bulletin' });
  });
  it('ignores a name that is not a theme', async () => {
    state.theme = undefined;
    expect(await run(null, '?previewTheme=neon')).toMatchObject({ forumTheme: 'midnight' });
  });
});
