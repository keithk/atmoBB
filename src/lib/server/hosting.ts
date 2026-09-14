import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '$env/dynamic/private';
import { fleetEnabled, fleetStatus, provisionHostedInstance } from './hosting-host';

// Invite requests stay in the app; the root-owned host service owns capacity
// reservations and isolated installations. Legacy dashboard sites are read-only.

export interface HostingInvite {
  code: string;
  note?: string;
  createdAt: string;
  usedBy?: string;
  usedAt?: string;
}

export type HostingRequestStatus = 'pending' | 'provisioning' | 'live' | 'failed' | 'rejected';

export interface HostingRequest {
  id: string;
  subdomain: string;
  forumHandle: string;
  forumDid: string;
  requesterDid: string;
  requesterHandle: string;
  email?: string;
  invite: string;
  createdAt: string;
  status: HostingRequestStatus;
  siteId?: string;
  isolated?: boolean;
  error?: string;
  notifiedAt?: string;
}

interface HostingStore {
  invites: HostingInvite[];
  requests: HostingRequest[];
}

export const hostingEnabled = () =>
  fleetEnabled() || (env.ATMOBB_HOSTING === '1' && Boolean(env.DEPLOY_SESSION_TOKEN));
export const hostingDomainSuffix = () => env.ATMOBB_HOSTING_DOMAIN_SUFFIX ?? 'atmobb.app';
export const tenantDomain = (subdomain: string) => `${subdomain}.${hostingDomainSuffix()}`;

const storePath = () => join(process.env.DATA_DIR ?? '.data', 'hosting.json');

async function loadStore(): Promise<HostingStore> {
  try {
    return JSON.parse(await readFile(storePath(), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { invites: [], requests: [] };
  }
}

async function saveStore(store: HostingStore) {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2));
  await rename(tmp, path);
}

// One mutation at a time; the store is a single JSON file.
let chain: Promise<unknown> = Promise.resolve();
function withStore<T>(fn: (store: HostingStore) => Promise<T> | T): Promise<T> {
  const run = chain.then(async () => {
    const store = await loadStore();
    const out = await fn(store);
    await saveStore(store);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

// Notification email, via Resend. Without a key this is a no-op, and a
// failed send never blocks the queue; the requester can always check /host.
async function sendMail(to: string, subject: string, text: string) {
  if (!env.RESEND_API_KEY) return;
  const from = env.ATMOBB_HOSTING_EMAIL_FROM ?? 'atmobb <forums@atmobb.app>';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
  } catch {
    // the queue page is the source of truth; email is a courtesy
  }
}

function liveEmail(r: HostingRequest): string {
  const domain = tenantDomain(r.subdomain);
  return `https://${domain} is yours.

Log in there with your personal account, open /admin, and connect the
forum account (@${r.forumHandle}) via OAuth. Then change that account's
handle to ${domain}; the site already serves the verification file, so
the handle change works without any DNS setup.

Boards, the forum name, and theming all live in /admin.

Your isolated installation supports members-only boards and Admin → Updates.
Your infrastructure operator remains trusted with the app and database.
Self-hosting is the same software:
https://github.com/keithk/atmoBB`;
}

export const SUBDOMAIN_RULE =
  'Use 3–30 lowercase letters, numbers, or hyphens. Start and end with a letter or number.';
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
// The queue and host registry also reserve existing forum names.
const RESERVED = new Set([
  'www', 'mail', 'smtp', 'hv', 'admin', 'api', 'app',
  'atmobb', 'forum', 'forums', 'dev', 'staging', 'test',
]);

export function validSubdomain(subdomain: string): string | null {
  if (!SUBDOMAIN_RE.test(subdomain)) return SUBDOMAIN_RULE;
  if (RESERVED.has(subdomain)) return 'That name is reserved.';
  return null;
}

export const listInvites = () => loadStore().then((s) => s.invites);
export const listRequests = () => loadStore().then((s) => s.requests);
export const requestsFor = (did: string) =>
  loadStore().then((s) => s.requests.filter((r) => r.requesterDid === did));

export function createInvite(note?: string): Promise<HostingInvite> {
  return withStore((store) => {
    const invite: HostingInvite = {
      code: randomBytes(6).toString('hex'),
      note: note || undefined,
      createdAt: new Date().toISOString(),
    };
    store.invites.push(invite);
    return invite;
  });
}

const activeStatus = (s: HostingRequestStatus) => s !== 'rejected';

export async function submitRequest(input: {
  code: string;
  subdomain: string;
  forumHandle: string;
  forumDid: string;
  requesterDid: string;
  requesterHandle: string;
  email?: string;
}): Promise<{ error: string } | { request: HostingRequest }> {
  if (!fleetEnabled()) return { error: 'New hosting requests are paused until isolated hosting is configured.' };
  let takenNames: Set<string>;
  try {
    const fleet = await fleetStatus();
    if (fleet.used >= fleet.limit) return { error: 'Hosting is currently full. Try again when the operator opens more places.' };
    takenNames = new Set(fleet.instances.map((s) => s.subdomain));
  } catch {
    return { error: "We can't accept hosting requests right now. Try again in a bit." };
  }

  return withStore((store) => {
    const invite = store.invites.find((i) => i.code === input.code.trim());
    if (!invite) return { error: 'That invite code isn\'t valid.' };
    if (invite.usedAt) return { error: 'That invite code has already been used.' };

    const subdomainError = validSubdomain(input.subdomain);
    if (subdomainError) return { error: subdomainError };
    if (
      takenNames.has(input.subdomain) ||
      store.requests.some((r) => r.subdomain === input.subdomain && activeStatus(r.status))
    ) {
      return { error: 'That subdomain is taken.' };
    }
    if (store.requests.some((r) => r.requesterDid === input.requesterDid && activeStatus(r.status))) {
      return { error: 'You already have a request in the queue.' };
    }

    const request: HostingRequest = {
      id: randomUUID(),
      subdomain: input.subdomain,
      forumHandle: input.forumHandle,
      forumDid: input.forumDid,
      requesterDid: input.requesterDid,
      requesterHandle: input.requesterHandle,
      email: input.email || undefined,
      invite: invite.code,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    invite.usedBy = input.requesterDid;
    invite.usedAt = request.createdAt;
    store.requests.push(request);
    return { request };
  });
}

/** Stable request IDs make approval retries idempotent at the host service. */
export function approveRequest(id: string): Promise<HostingRequest | null> {
  return withStore(async (store) => {
    const r = store.requests.find((q) => q.id === id);
    if (!r || (r.status !== 'pending' && r.status !== 'failed')) return r ?? null;
    try {
      if (r.siteId) throw new Error('Legacy dashboard installations require an explicit migration; automatic reprovisioning is disabled.');
      const instance = await provisionHostedInstance({
        id: r.id, subdomain: r.subdomain, forumDid: r.forumDid, adminHandle: r.requesterHandle,
      });
      r.isolated = true;
      // checkProvisioning handles the live transition and notification.
      r.status = instance.status === 'failed' ? 'failed' : 'provisioning';
      delete r.error;
    } catch (e) {
      r.status = 'failed';
      r.error = e instanceof Error ? e.message : 'provisioning failed';
    }
    return r;
  });
}

export function rejectRequest(id: string): Promise<void> {
  return withStore((store) => {
    const r = store.requests.find((q) => q.id === id);
    if (r?.isolated || r?.siteId) throw new Error('An installation may exist. Reconcile it on the host before rejecting this request.');
    // Even a timed-out approval may have reserved a slot. Fail closed.
    if (r?.status === 'failed') throw new Error('Retry approval to reconcile this failed request before rejecting it.');
    if (r && (r.status === 'pending' || r.status === 'failed')) {
      r.status = 'rejected';
      if (r.email && !r.notifiedAt) {
        r.notifiedAt = new Date().toISOString();
        void sendMail(
          r.email,
          'about your atmobb forum request',
          `We didn't take ${tenantDomain(r.subdomain)} forward. If that's a surprise, reply to this email.`,
        );
      }
    }
  });
}

/** Reconcile durable host state, including approvals whose response was lost. */
export function checkProvisioning(): Promise<void> {
  return withStore(async (store) => {
    if (!fleetEnabled()) return;
    const fleet = await fleetStatus();
    for (const r of store.requests) {
      if (r.siteId) continue;
      const instance = fleet.instances.find((i) => i.id === r.id);
      if (!instance) continue;
      r.isolated = true;
      r.status = instance.status;
      r.error = instance.error;
      if (r.status === 'live' && r.email && !r.notifiedAt) {
        r.notifiedAt = new Date().toISOString();
        void sendMail(r.email, 'your forum is live', liveEmail(r));
      }
    }
  });
}
