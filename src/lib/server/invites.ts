import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  RESERVATION_TTL_MS,
  canMint,
  inviteExpiry,
  inviteState,
  newToken,
  openInvites,
  type Invite,
  type InviteState,
} from '$lib/invites';

// Invite links for a gated forum, one JSON file under DATA_DIR. The token in
// the link is the whole secret, so invites are never atproto records. Every
// mutation runs on one promise chain and lands via write-temp-then-rename.
//
// Unlike the hosting store, this one fails closed: a missing file is an empty
// store, but any other read error refuses every mint and redeem, because a
// corrupt file silently read as empty would bring dead invites back to life.

interface InviteStore {
  invites: Invite[];
}

const storePath = () => join(process.env.DATA_DIR ?? '.data', 'invites.json');

let chain: Promise<unknown> = Promise.resolve();

export function resetInviteStoreForTests() {
  chain = Promise.resolve();
}

async function loadStore(): Promise<InviteStore> {
  try {
    return JSON.parse(await readFile(storePath(), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { invites: [] };
    throw err;
  }
}

async function saveStore(store: InviteStore) {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2));
  await rename(tmp, path);
}

function withStore<T>(fn: (store: InviteStore) => T): Promise<T> {
  const run = chain.then(async () => {
    const store = await loadStore();
    const out = fn(store);
    await saveStore(store);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

export async function listInvites(): Promise<Invite[]> {
  return (await loadStore()).invites;
}

export async function getInvite(token: string): Promise<Invite | undefined> {
  return (await loadStore()).invites.find((i) => i.token === token);
}

/** Mint one invite for `minter`, honoring the member cap unless `staff`. */
export function mintInvite(input: {
  minter: string;
  days: number;
  cap: number;
  staff: boolean;
  now?: Date;
}): Promise<{ invite: Invite } | { error: string }> {
  return withStore((store) => {
    const now = input.now ?? new Date();
    const open = openInvites(store.invites, input.minter, now).length;
    if (!canMint({ cap: input.cap, open, staff: input.staff })) {
      return {
        error:
          input.cap === 0
            ? 'Only staff can mint invites on this forum.'
            : `You already have ${open} open invite${open === 1 ? '' : 's'}; the limit is ${input.cap}.`,
      };
    }
    const invite: Invite = {
      token: newToken(),
      minter: input.minter,
      createdAt: now.toISOString(),
      expiresAt: inviteExpiry(input.days, now),
    };
    store.invites.push(invite);
    return { invite };
  });
}

/** Revoke an open or reserved invite. Only its minter or an admin may. */
export function revokeInvite(token: string, actor: string, admin: boolean, now = new Date()): Promise<boolean> {
  return withStore((store) => {
    const invite = store.invites.find((i) => i.token === token);
    if (!invite || (invite.minter !== actor && !admin)) return false;
    const state = inviteState(invite, now);
    if (state !== 'open' && state !== 'reserved') return false;
    invite.revokedAt = now.toISOString();
    return true;
  });
}

/**
 * Claim the token before any network write, so two concurrent submissions
 * cannot both spend one link. Returns the invite on success or the state
 * that stopped it. A reservation older than the TTL is treated as released.
 */
export function reserveInvite(
  token: string,
  now = new Date(),
): Promise<{ invite: Invite } | { state: InviteState | 'unknown' }> {
  return withStore((store) => {
    const invite = store.invites.find((i) => i.token === token);
    if (!invite) return { state: 'unknown' };
    const state = inviteState(invite, now);
    if (state !== 'open') return { state };
    invite.reservedAt = now.toISOString();
    return { invite };
  });
}

/** Give a reserved token back after the acceptance write failed. */
export function releaseInvite(token: string): Promise<void> {
  return withStore((store) => {
    const invite = store.invites.find((i) => i.token === token);
    if (invite && !invite.redeemedAt) delete invite.reservedAt;
  });
}

/** Mark a reserved token spent once the forum has signed the acceptance. */
export function redeemInvite(token: string, by: string, now = new Date()): Promise<boolean> {
  return withStore((store) => {
    const invite = store.invites.find((i) => i.token === token);
    if (!invite || invite.redeemedAt) return false;
    invite.redeemedAt = now.toISOString();
    invite.redeemedBy = by;
    delete invite.reservedAt;
    return true;
  });
}

export { RESERVATION_TTL_MS };
