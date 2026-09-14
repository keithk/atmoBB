import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ admin: vi.fn(), capacity: vi.fn(), update: vi.fn(), check: vi.fn() }));
vi.mock('$lib/server/admin', () => ({ adminActor: state.admin }));
vi.mock('$lib/server/hosting-host', () => ({ fleetEnabled: () => true, fleetStatus: async () => ({ limit: 3, used: 0, instances: [] }), setHostingLimit: state.capacity, updateHostedInstance: state.update }));
vi.mock('$lib/server/hosting', () => ({ hostingEnabled: () => true, hostingDomainSuffix: () => 'example.test', checkProvisioning: state.check, listInvites: async () => [], listRequests: async () => [], approveRequest: vi.fn(), rejectRequest: vi.fn(), createInvite: vi.fn() }));
import { actions, load } from './+page.server';

beforeEach(() => { vi.clearAllMocks(); state.admin.mockResolvedValue('did:plc:operator'); state.check.mockResolvedValue(undefined); });
const event = (values: Record<string, string> = {}) => ({ locals: {}, request: new Request('http://example.test/admin/hosting', { method: 'POST', body: new URLSearchParams(values) }) }) as never;

it('rechecks admin access for the page and every mutation', async () => {
  state.admin.mockResolvedValue(null);
  await expect(load(event())).rejects.toMatchObject({ status: 403 });
  for (const action of Object.values(actions)) expect(await action!(event())).toMatchObject({ status: 403 });
  expect(state.capacity).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.check).not.toHaveBeenCalled();
});

it('accepts zero and boundary capacity but rejects fractional, negative, missing, and excessive limits', async () => {
  for (const limit of ['0', '7', '1000']) await actions.capacity!(event({ limit }));
  expect(state.capacity.mock.calls).toEqual([[0], [7], [1000]]);
  for (const limit of ['', '-1', '1.5', '1001', 'Infinity']) expect(await actions.capacity!(event({ limit }))).toMatchObject({ status: 400 });
  expect(state.capacity).toHaveBeenCalledTimes(3);
});

it('requires literal confirmation for main and forwards exactly the selected instance', async () => {
  for (const confirmation of ['', 'Main', 'main ']) expect(await actions.update!(event({ id: 'one', target: 'main', confirmation }))).toMatchObject({ status: 400 });
  expect(await actions.update!(event({ id: 'one', target: 'shell' }))).toMatchObject({ status: 400 });
  expect(state.update).not.toHaveBeenCalled();
  await actions.update!(event({ id: 'two', target: 'stable' }));
  await actions.update!(event({ id: 'one', target: 'main', confirmation: 'main' }));
  expect(state.update.mock.calls).toEqual([['two', 'stable'], ['one', 'main']]);
});

it('keeps the queue view available when reconciliation cannot reach the host', async () => {
  state.check.mockRejectedValue(new Error('host unavailable'));
  expect(await load(event())).toMatchObject({ fleet: null, fleetError: 'host unavailable', requests: [] });
});
