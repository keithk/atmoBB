import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('$lib/server/pds', () => ({ saveProfile: state.save }));
vi.mock('$lib/server/profiles', () => ({ bustProfileCache: vi.fn() }));
vi.mock('$lib/server/atproto-oauth', () => ({ agentFor: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: { ATMOBB_FORUM_DID: 'did:plc:current' } }));
import { actions } from './+page.server';

beforeEach(() => state.save.mockReset());
async function save(scope: string, notifications: string, authenticated = true) {
  return actions.preferences!({ locals: { user: authenticated ? { did: 'did:plc:user' } : null },
    request: new Request('http://localhost/settings/notifications', { method: 'POST', body: new URLSearchParams({ scope, notifications }) }),
  } as never);
}
it('saves global and forum choices, and removes only the notification override when inheriting', async () => {
  await save('all', 'off');
  expect(state.save).toHaveBeenLastCalledWith('did:plc:user', { notifications: false }, undefined, []);
  await save('forum', 'on');
  expect(state.save).toHaveBeenLastCalledWith('did:plc:user', { notifications: true }, 'did:plc:current', []);
  await save('forum', 'inherit');
  expect(state.save).toHaveBeenLastCalledWith('did:plc:user', { notifications: false }, 'did:plc:current', ['notifications']);
});
it('requires valid scope, preference and authentication', async () => {
  expect(await save('all', 'inherit')).toMatchObject({ status: 400 });
  expect(await save('forum', 'invalid')).toMatchObject({ status: 400 });
  expect(await save('invalid', 'on')).toMatchObject({ status: 400 });
  expect(await save('forum', 'on', false)).toMatchObject({ status: 401 });
  expect(state.save).not.toHaveBeenCalled();
});
