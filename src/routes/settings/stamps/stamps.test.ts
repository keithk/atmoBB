import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrayEntry } from '$lib/server/appview';

const state = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), redirect: vi.fn() }));
vi.mock('$lib/server/appview', () => ({
  FORUM_DID: () => 'did:plc:forum',
  getStamps: state.read,
  resolveHandle: async () => 'sponsor.test',
}));
vi.mock('$lib/server/pds', () => ({ setWearing: state.save }));
vi.mock('$lib/server/saved-redirect', () => ({ savedRedirect: state.redirect }));
import { actions, load } from './+page.server';

const tray: TrayEntry[] = Array.from({ length: 7 }, (_, i) => ({ id: `stamp-${i}`, name: `Stamp ${i}`, source: 'admin' }));
const user = { did: 'did:plc:member', handle: 'member.test' };
function event(wear: string[] = [], extra: Record<string, string> = {}, authenticated = true) {
  const body = new URLSearchParams(wear.map((id) => ['wear', id]));
  for (const [key, value] of Object.entries(extra)) body.append(key, value);
  return { locals: { user: authenticated ? user : null }, request: new Request('http://localhost/settings/stamps', { method: 'POST', body }) } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  state.read.mockResolvedValue({ tray, worn: [] });
});

describe('stamp settings actions', () => {
  it('saves all six in order, using the session actor and configured forum', async () => {
    const ids = tray.slice(0, 6).map((entry) => entry.id).reverse();
    await actions.save!(event(ids, { forum: 'did:plc:forged' }));
    expect(state.save).toHaveBeenCalledWith(user.did, 'did:plc:forum', ids);
    const indexed = state.redirect.mock.calls[0][2];
    expect(indexed({ worn: ids })).toBe(true);
    expect(indexed({ worn: ids.slice(0, 3) })).toBe(false);
  });

  it('supports no-JS wear, take off and move actions without losing other selections', async () => {
    await actions.toggle!(event(['stamp-0'], { toggle: 'stamp-1' }));
    expect(state.save).toHaveBeenLastCalledWith(user.did, 'did:plc:forum', ['stamp-0', 'stamp-1']);
    await actions.toggle!(event(['stamp-0', 'stamp-1'], { toggle: 'stamp-0' }));
    expect(state.save).toHaveBeenLastCalledWith(user.did, 'did:plc:forum', ['stamp-1']);
    await actions.move!(event(['stamp-0', 'stamp-1', 'stamp-2'], { move: 'up:stamp-2' }));
    expect(state.save).toHaveBeenLastCalledWith(user.did, 'did:plc:forum', ['stamp-0', 'stamp-2', 'stamp-1']);
  });

  it('allows wearing nothing and filters forged or retired ids and duplicates', async () => {
    await actions.save!(event());
    expect(state.save).toHaveBeenLastCalledWith(user.did, 'did:plc:forum', []);
    await actions.save!(event(['stamp-1', 'forged', 'stamp-1']));
    expect(state.save).toHaveBeenLastCalledWith(user.did, 'did:plc:forum', ['stamp-1']);
  });

  it('rejects a seventh choice and unauthenticated writes', async () => {
    const ids = tray.map((entry) => entry.id);
    expect(await actions.save!(event(ids))).toMatchObject({ status: 400, data: { wear: ids } });
    expect(await actions.toggle!(event(ids.slice(0, 6), { toggle: ids[6] }))).toMatchObject({ status: 400 });
    for (const action of Object.values(actions)) expect(await action!(event([], {}, false))).toMatchObject({ status: 401 });
    expect(state.save).not.toHaveBeenCalled();
  });

  it('preserves the submitted draft when reading or writing fails', async () => {
    state.read.mockRejectedValueOnce(new Error('offline'));
    expect(await actions.save!(event(['stamp-2', 'stamp-0']))).toMatchObject({ status: 502, data: { wear: ['stamp-2', 'stamp-0'] } });
    state.save.mockRejectedValueOnce(new Error('offline'));
    expect(await actions.save!(event(['stamp-2', 'stamp-0']))).toMatchObject({ status: 502, data: { wear: ['stamp-2', 'stamp-0'] } });
    expect(state.redirect).not.toHaveBeenCalled();
  });

  it('loads six choices and resolves sponsors for unworn stamps too', async () => {
    const arrival = { id: 'atmobb:arrival', name: 'brought in', source: 'default', sponsor: 'did:plc:sponsor' };
    const ids = tray.slice(0, 6).map((entry) => entry.id);
    state.read.mockResolvedValue({ tray: [...tray, arrival], worn: ids });
    expect(await load(event())).toMatchObject({ handle: 'member.test', worn: ids, handles: { 'did:plc:sponsor': 'sponsor.test' } });
    await expect(load(event([], {}, false))).rejects.toMatchObject({ status: 302, location: '/login' });
  });
});
