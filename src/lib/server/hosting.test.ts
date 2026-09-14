import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const host = vi.hoisted(() => ({ provision: vi.fn(), status: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('./hosting-host', () => ({ fleetEnabled: () => true, fleetStatus: host.status, provisionHostedInstance: host.provision }));
import { approveRequest, checkProvisioning, createInvite, hostingPage, listInvites, listRequests, rejectRequest, saveHostingPage, submitRequest } from './hosting';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-hosting-test-'));
  vi.stubEnv('DATA_DIR', directory);
  host.status.mockResolvedValue({ limit: 2, used: 0, instances: [] });
  host.provision.mockReset();
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
async function request() {
  const invite = await createInvite();
  const result = await submitRequest({ code: invite.code, subdomain: 'gardening', forumHandle: 'garden.example.test', forumDid: 'did:plc:garden', requesterDid: 'did:plc:owner', requesterHandle: 'owner.example.test' });
  if ('error' in result) throw new Error(result.error);
  return result.request;
}
it('reuses the durable request ID after an ambiguous timeout and reconciles host state', async () => {
  const r = await request();
  host.provision.mockRejectedValueOnce(new Error('timed out')).mockResolvedValue({ status: 'provisioning' });
  expect(await approveRequest(r.id)).toMatchObject({ status: 'failed' });
  await expect(rejectRequest(r.id)).rejects.toThrow('reconcile');
  await approveRequest(r.id);
  expect(host.provision.mock.calls).toEqual(Array(2).fill([{ id: r.id, subdomain: 'gardening', forumDid: 'did:plc:garden', adminHandle: 'owner.example.test' }]));
  host.status.mockResolvedValue({ limit: 2, used: 1, instances: [{ id: r.id, status: 'live' }] });
  await checkProvisioning();
  expect(await listRequests()).toMatchObject([{ id: r.id, isolated: true, status: 'live' }]);
});
it('never reprovisions a legacy dashboard installation', async () => {
  const r = await request();
  const store = JSON.parse(await readFile(join(directory, 'hosting.json'), 'utf8'));
  Object.assign(store.requests[0], { siteId: 'legacy-site', status: 'failed' });
  await writeFile(join(directory, 'hosting.json'), JSON.stringify(store));
  expect(await approveRequest(r.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('explicit migration') });
  expect(host.provision).not.toHaveBeenCalled();
});
it('does not discard corrupt queue state', async () => {
  await writeFile(join(directory, 'hosting.json'), '{corrupt');
  await expect(createInvite()).rejects.toThrow();
  expect(await readFile(join(directory, 'hosting.json'), 'utf8')).toBe('{corrupt');
});
it('takes requests without a code once invites are off, leaving unused codes unspent', async () => {
  expect(await hostingPage()).toMatchObject({ requireInvite: true });
  const invite = await createInvite();
  expect(await submitRequest({ code: '', subdomain: 'crochet', forumHandle: 'crochet.example.test', forumDid: 'did:plc:crochet', requesterDid: 'did:plc:maker', requesterHandle: 'maker.example.test' })).toMatchObject({ error: expect.stringContaining('invite') });
  await saveHostingPage({ heading: 'Free forums', requireInvite: false });
  const result = await submitRequest({ code: invite.code, subdomain: 'crochet', forumHandle: 'crochet.example.test', forumDid: 'did:plc:crochet', requesterDid: 'did:plc:maker', requesterHandle: 'maker.example.test', about: 'A pattern app', aboutUrl: 'https://patterns.example.test' });
  expect(result).toMatchObject({ request: { subdomain: 'crochet', about: 'A pattern app', aboutUrl: 'https://patterns.example.test' } });
  expect('request' in result && result.request.invite).toBeUndefined();
  expect((await listInvites()).find((i) => i.code === invite.code)?.usedAt).toBeUndefined();
});
