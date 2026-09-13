import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getInvite,
  listInvites,
  mintInvite,
  redeemInvite,
  releaseInvite,
  reserveInvite,
  resetInviteStoreForTests,
  revokeInvite,
} from './invites';

let dir: string;
const minter = 'did:plc:dave';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atmobb-invites-'));
  process.env.DATA_DIR = dir;
  resetInviteStoreForTests();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('mintInvite', () => {
  it('mints under the cap and refuses at it', async () => {
    const a = await mintInvite({ minter, days: 14, cap: 2, staff: false });
    const b = await mintInvite({ minter, days: 14, cap: 2, staff: false });
    const c = await mintInvite({ minter, days: 14, cap: 2, staff: false });
    expect('invite' in a && 'invite' in b).toBe(true);
    expect(c).toEqual({ error: expect.stringContaining('limit is 2') });
    expect((await listInvites()).length).toBe(2);
  });
  it('lets staff mint when the cap is 0', async () => {
    expect('invite' in (await mintInvite({ minter, days: 14, cap: 0, staff: true }))).toBe(true);
    expect(await mintInvite({ minter, days: 14, cap: 0, staff: false })).toEqual({ error: expect.stringContaining('staff') });
  });
});

describe('reserve, redeem, release', () => {
  it('lets exactly one concurrent reservation win', async () => {
    const minted = await mintInvite({ minter, days: 14, cap: 3, staff: false });
    const token = 'invite' in minted ? minted.invite.token : '';
    const [x, y] = await Promise.all([reserveInvite(token), reserveInvite(token)]);
    const won = [x, y].filter((r) => 'invite' in r);
    const lost = [x, y].filter((r) => 'state' in r);
    expect(won.length).toBe(1);
    expect(lost).toEqual([{ state: 'reserved' }]);
  });
  it('refuses a second redeem and reports the state', async () => {
    const minted = await mintInvite({ minter, days: 14, cap: 3, staff: false });
    const token = 'invite' in minted ? minted.invite.token : '';
    await reserveInvite(token);
    expect(await redeemInvite(token, 'did:plc:n')).toBe(true);
    expect(await redeemInvite(token, 'did:plc:n')).toBe(false);
    expect(await reserveInvite(token)).toEqual({ state: 'redeemed' });
    expect((await getInvite(token))?.reservedAt).toBeUndefined();
  });
  it('release makes a reserved token open again', async () => {
    const minted = await mintInvite({ minter, days: 14, cap: 3, staff: false });
    const token = 'invite' in minted ? minted.invite.token : '';
    await reserveInvite(token);
    await releaseInvite(token);
    expect('invite' in (await reserveInvite(token))).toBe(true);
  });
  it('reports an unknown token', async () => {
    expect(await reserveInvite('nope')).toEqual({ state: 'unknown' });
  });
});

describe('revokeInvite', () => {
  it('allows the minter or an admin, and is a no-op on a redeemed invite', async () => {
    const minted = await mintInvite({ minter, days: 14, cap: 3, staff: false });
    const token = 'invite' in minted ? minted.invite.token : '';
    expect(await revokeInvite(token, 'did:plc:other', false)).toBe(false);
    expect(await revokeInvite(token, 'did:plc:other', true)).toBe(true);
    const again = await mintInvite({ minter, days: 14, cap: 3, staff: false });
    const t2 = 'invite' in again ? again.invite.token : '';
    await reserveInvite(t2);
    await redeemInvite(t2, 'did:plc:n');
    expect(await revokeInvite(t2, minter, false)).toBe(false);
  });
});

describe('store failure modes', () => {
  it('reads a missing file as empty', async () => {
    expect(await listInvites()).toEqual([]);
  });
  it('fails closed on a corrupt file', async () => {
    await writeFile(join(dir, 'invites.json'), '{not json');
    await expect(mintInvite({ minter, days: 14, cap: 3, staff: true })).rejects.toThrow();
    await expect(reserveInvite('x')).rejects.toThrow();
    expect(await readFile(join(dir, 'invites.json'), 'utf8')).toBe('{not json');
  });
});
