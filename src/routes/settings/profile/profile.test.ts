import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ save: vi.fn(), profile: {} as Record<string, unknown> }));
vi.mock('$lib/server/pds', () => ({ getActorProfile: async () => state.profile, saveProfile: state.save }));
vi.mock('$lib/server/profiles', () => ({ blobCid: () => null, bustProfileCache: vi.fn(), getBskyProfile: async () => null }));
vi.mock('$lib/server/richtext', () => ({ attachImages: (blocks: unknown[]) => blocks, resolveBodyImages: async () => {} }));
vi.mock('$lib/server/appview', () => ({ FORUM_DID: () => 'did:plc:current' }));
import { actions, load } from './+page.server';

const user = { did: 'did:plc:member', handle: 'member.test' };
function event(scope: string, values: [string, string][] = [], authenticated = true) {
  const url = new URL(`http://localhost/settings/profile?/save&scope=${scope}`);
  return { locals: { user: authenticated ? user : null }, url, request: new Request(url, { method: 'POST', body: new URLSearchParams(values) }) } as never;
}
beforeEach(() => {
  state.save.mockReset();
  state.profile = { displayName: 'Global name', signature: [{ $type: 'app.atmobb.richtext.block#text', text: 'Global signature' }],
    forumProfiles: [{ forum: 'did:plc:current', fields: ['signature'] }] };
});
describe('profile editor scope', () => {
  it('loads an explicitly empty forum signature rather than the account signature', async () => {
    const local = await load(event('forum'));
    expect(local).toMatchObject({ scope: 'forum', overriddenFields: ['signature'], profile: { displayName: 'Global name', signature: '' } });
    expect(await load(event('all'))).toMatchObject({ scope: 'all', profile: { signature: 'Global signature' } });
  });
  it('saves a local empty signature with other fields inheriting, using the configured forum', async () => {
    await actions.save!(event('forum', [['signature', ''], ['inherit', 'displayName'], ['inherit', 'description'], ['inherit', 'pronouns'], ['inherit', 'website'], ['inherit', 'avatar'], ['forum', 'did:plc:forged']]));
    expect(state.save).toHaveBeenCalledWith(user.did, expect.objectContaining({ signature: [] }), 'did:plc:current', ['displayName', 'description', 'pronouns', 'website', 'avatar']);
  });
  it('saves account defaults without applying forum inheritance flags', async () => {
    await actions.save!(event('all', [['signature', 'Account signature'], ['inherit', 'signature']]));
    expect(state.save).toHaveBeenCalledWith(user.did, expect.objectContaining({ signature: [{ $type: 'app.atmobb.richtext.block#text', text: 'Account signature' }] }), undefined, []);
  });
  it('restores the Bluesky avatar only in the selected scope', async () => {
    await actions.restoreAvatar!(event('forum'));
    expect(state.save).toHaveBeenLastCalledWith(user.did, { avatar: null }, 'did:plc:current');
    await actions.restoreAvatar!(event('all'));
    expect(state.save).toHaveBeenLastCalledWith(user.did, { avatar: null }, undefined);
  });
  it('rejects invalid scope, unauthenticated writes and invalid websites', async () => {
    expect(await actions.save!(event('wrong'))).toMatchObject({ status: 400 });
    expect(await actions.save!(event('forum', [], false))).toMatchObject({ status: 401 });
    expect(await actions.save!(event('forum', [['website', 'javascript:alert(1)']]))).toMatchObject({ status: 400 });
    expect(state.save).not.toHaveBeenCalled();
  });
});
