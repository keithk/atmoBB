import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ theme: undefined as unknown }));
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => 'did:plc:forum',
  getBoardIndex: async () => ({ boards: [], forum: { name: 'Forum', theme: 'forest', customCss: ':root{color:red}' } }),
  getStanding: async () => null,
}));
vi.mock('$lib/server/pds', () => ({ getMembership: async () => null, getOwnAvatarProfile: async () => ({ theme: state.theme }) }));
vi.mock('$lib/server/admin', () => ({ staffRole: async () => null, forumUnclaimed: async () => false }));
vi.mock('$lib/server/webring', () => ({ ringForums: async () => [] }));
vi.mock('$lib/server/profiles', () => ({ blobCid: () => null, blobUrl: async () => null }));
vi.mock('$lib/server/notify/store', () => ({ readMember: async () => null, countUnread: () => 0 }));
vi.mock('$lib/server/membership', () => ({ forumStanding: async () => ({ mode: 'open', standing: 'open' }) }));
import { load } from './+layout.server';

describe('personal theme precedence', () => {
  it.each(['classic', 'midnight'])('uses personal %s while preserving forum CSS', async (theme) => {
    state.theme = theme;
    const data = await load({ locals: { user: { did: 'did:plc:user' } }, route: { id: '/' } } as never);
    expect(data).toMatchObject({ forumTheme: theme, forumCustomCss: ':root{color:red}' });
    expect(data?.personalThemeCss).toContain(theme === 'classic' ? '--forum-bg:#eceae7;' : '--forum-bg:#12131a;');
  });
  it.each([undefined, 'unknown', 42])('keeps forum styling for invalid or absent preference %s', async (theme) => {
    state.theme = theme;
    const data = await load({ locals: { user: { did: 'did:plc:user' } }, route: { id: '/' } } as never);
    expect(data).toMatchObject({ forumTheme: 'forest', forumCustomCss: ':root{color:red}' });
  });
  it('keeps forum styling for guests', async () => {
    state.theme = 'midnight';
    const data = await load({ locals: { user: null }, route: { id: '/' } } as never);
    expect(data).toMatchObject({ forumTheme: 'forest', forumCustomCss: ':root{color:red}' });
  });
});
