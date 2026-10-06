import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminActor: vi.fn(),
  createUpdaterSession: vi.fn(),
  triggerUpdate: vi.fn(),
  triggerMaintenance: vi.fn(),
  updateStatus: vi.fn(),
  updatesEnabled: vi.fn(() => true),
}));
vi.mock('$lib/server/admin', () => ({ adminActor: mocks.adminActor }));
vi.mock('$lib/server/updates', () => mocks);

import { actions, load } from './+page.server';

function event(confirmation = '') {
  const form = new FormData();
  form.set('confirmation', confirmation);
  return {
    locals: {},
    cookies: { set: vi.fn() },
    request: new Request('https://forum.test/admin/updates', { method: 'POST', body: form }),
  };
}

describe('admin maintenance handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminActor.mockResolvedValue('did:plc:admin');
    mocks.createUpdaterSession.mockResolvedValue({ token: 'short-lived-session', expiresAt: '2030-01-01T00:00:00Z' });
  });

  it('denies non-admin session issuance and actions', async () => {
    mocks.adminActor.mockResolvedValue(null);
    for (const name of ['stable', 'main', 'maintenance', 'console']) {
      // SvelteKit provides the remaining RequestEvent fields at runtime.
      const result = await actions[name](event('main') as never);
      expect(result).toMatchObject({ status: 403 });
    }
    expect(mocks.createUpdaterSession).not.toHaveBeenCalled();
    expect(mocks.triggerUpdate).not.toHaveBeenCalled();
    expect(mocks.triggerMaintenance).not.toHaveBeenCalled();
  });

  it('does not expose logs to an unauthorized page load', async () => {
    mocks.adminActor.mockResolvedValue(null);
    await expect(load(event() as never)).rejects.toMatchObject({ status: 403 });
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it('issues an HttpOnly scoped session before starting an update, then leaves the app', async () => {
    const request = event();
    await expect(actions.stable(request as never)).rejects.toMatchObject({ status: 303, location: '/_atmobb/' });
    expect(request.cookies.set).toHaveBeenCalledWith('atmobb_updater', 'short-lived-session', {
      path: '/_atmobb', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 43200,
    });
    expect(mocks.createUpdaterSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.triggerUpdate.mock.invocationCallOrder[0]);
    expect(mocks.triggerUpdate).toHaveBeenCalledWith('stable');
  });

  it('requires main confirmation before session issuance or update', async () => {
    expect(await actions.main(event('MAIN') as never)).toMatchObject({ status: 400 });
    expect(mocks.createUpdaterSession).not.toHaveBeenCalled();
    expect(mocks.triggerUpdate).not.toHaveBeenCalled();
  });

  it('never starts the update without a recovery session', async () => {
    mocks.createUpdaterSession.mockRejectedValue(new Error('updater unavailable'));
    expect(await actions.stable(event() as never)).toMatchObject({ status: 502 });
    expect(mocks.triggerUpdate).not.toHaveBeenCalled();
  });

  it('hands manual maintenance and console access to the independent updater', async () => {
    await expect(actions.maintenance(event() as never)).rejects.toMatchObject({ status: 303, location: '/_atmobb/' });
    expect(mocks.triggerMaintenance).toHaveBeenCalledWith('on');
    mocks.triggerMaintenance.mockClear();
    await expect(actions.console(event() as never)).rejects.toMatchObject({ status: 303, location: '/_atmobb/' });
    expect(mocks.triggerMaintenance).not.toHaveBeenCalled();
  });
});
