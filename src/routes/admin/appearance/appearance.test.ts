import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ admin: vi.fn(), index: vi.fn(), put: vi.fn(), redirect: vi.fn() }));
vi.mock('$lib/server/admin', () => ({ adminActor: state.admin }));
vi.mock('$lib/server/appview', () => ({ getBoardIndex: state.index, FORUM_DID: () => 'did:plc:forum' }));
vi.mock('$lib/server/forum-repo', () => ({ putForumRecord: state.put }));
vi.mock('$lib/server/saved-redirect', () => ({ savedRedirect: state.redirect }));
import { actions } from './+page.server';

const forum = { name: 'Test forum', theme: 'midnight', hideDefaultStamps: true };
const event = (values: Record<string, string> = {}) =>
  ({ locals: {}, request: new Request('http://example.test/admin/appearance', { method: 'POST', body: new URLSearchParams(values) }) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  state.admin.mockResolvedValue('did:plc:admin');
  state.index.mockResolvedValue({ forum: { ...forum } });
});

it('turns profile skins off and keeps the other forum profile fields', async () => {
  await actions.setHideProfileSkins!(event({ hideProfileSkins: 'on' }));
  expect(state.put).toHaveBeenCalledWith('app.atmobb.forum.profile', 'self', { ...forum, hideProfileSkins: true });
  expect(state.redirect.mock.calls[0][0]).toBe('/admin/appearance?saved=profile-skins');
});

it('turns profile skins back on by omitting the field', async () => {
  state.index.mockResolvedValue({ forum: { ...forum, hideProfileSkins: true } });
  await actions.setHideProfileSkins!(event());
  const saved = state.put.mock.calls[0][2];
  expect(saved).toEqual(forum);
  expect('hideProfileSkins' in saved).toBe(false);
});

it('refuses non-admins without writing', async () => {
  state.admin.mockResolvedValue(null);
  expect(await actions.setHideProfileSkins!(event({ hideProfileSkins: 'on' }))).toMatchObject({ status: 403 });
  expect(state.put).not.toHaveBeenCalled();
});

it('holds the redirect until the indexed profile carries the new skins setting', async () => {
  await actions.setHideProfileSkins!(event({ hideProfileSkins: 'on' }));
  const landed = state.redirect.mock.calls[0][2] as (i: { forum: object }) => boolean;
  expect(landed({ forum })).toBe(false);
  expect(landed({ forum: { ...forum, hideProfileSkins: true } })).toBe(true);
});
