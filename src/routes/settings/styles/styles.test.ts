import { beforeEach, describe, expect, it, vi } from 'vitest';
import { personalTheme } from '$lib/themes';

const state = vi.hoisted(() => ({ profile: {} as Record<string, unknown>, save: vi.fn() }));
vi.mock('$lib/server/appview', () => ({ FORUM_DID: () => 'did:plc:current' }));
vi.mock('$lib/server/pds', () => ({ getActorProfile: async () => state.profile, saveProfile: state.save }));
import { actions, load } from './+page.server';

beforeEach(() => {
  state.save.mockReset();
  state.profile = { displayName: 'Keep me', theme: 'forest', forumThemes: [
    { forum: 'did:plc:other', theme: 'sky' }, { forum: 'did:plc:current', theme: 'midnight' },
  ] };
});

async function save(scope: string, theme: string, user: unknown = { did: 'did:plc:user' }) {
  return actions.default!({ locals: { user }, request: new Request('http://localhost/settings/styles', {
    method: 'POST', body: new URLSearchParams({ scope, theme }),
  }) } as never);
}

describe('scoped styles', () => {
  it('saves a forum opt-out without altering the global theme or another forum', async () => {
    await save('forum', '');
    expect(state.save).toHaveBeenCalledWith('did:plc:user', { forumThemes: [
      { forum: 'did:plc:other', theme: 'sky' }, { forum: 'did:plc:current', theme: '' },
    ] });
  });
  it('removes just this forum override when returning to the account default', async () => {
    await save('forum', 'inherit');
    expect(state.save).toHaveBeenCalledWith('did:plc:user', { forumThemes: [{ forum: 'did:plc:other', theme: 'sky' }] });
  });
  it('changes only the account default', async () => {
    await save('all', 'bubblegum');
    expect(state.save).toHaveBeenCalledWith('did:plc:user', { theme: 'bubblegum' });
  });
  it.each([['all', 'inherit'], ['forum', 'invalid'], ['unknown', 'sky']])('rejects %s / %s', async (scope, theme) => {
    expect(await save(scope, theme)).toMatchObject({ status: 400 });
    expect(state.save).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    expect(await save('all', 'sky', null)).toMatchObject({ status: 401 });
    expect(state.save).not.toHaveBeenCalled();
  });
  it('loads an explicit opt-out rather than treating it as inheritance', async () => {
    state.profile.forumThemes = [{ forum: 'did:plc:current', theme: '' }];
    expect(await load({ locals: { user: { did: 'did:plc:user' } } } as never)).toEqual({ globalTheme: 'forest', localTheme: '' });
  });
  it('resolves forum > global > owner, including explicit opt-out and invalid records', () => {
    expect(personalTheme(state.profile, 'did:plc:current')).toBe('midnight');
    expect(personalTheme(state.profile, 'did:plc:other')).toBe('sky');
    expect(personalTheme(state.profile, 'did:plc:new')).toBe('forest');
    state.profile.forumThemes = [{ forum: 'did:plc:current', theme: '' }];
    expect(personalTheme(state.profile, 'did:plc:current')).toBe('');
    state.profile.forumThemes = [{ forum: 'did:plc:current', theme: 'invalid' }];
    expect(personalTheme(state.profile, 'did:plc:current')).toBe('forest');
    expect(personalTheme(null, 'did:plc:current')).toBe('');
  });
});
