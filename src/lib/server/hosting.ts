import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '$env/dynamic/private';

// Invite-gated signup for hosted tenant forums. Requests queue in DATA_DIR;
// an admin approves one and this module provisions the site through the
// deploy dashboard API. Only a deployment with ATMOBB_HOSTING=1 and a
// dashboard session token gets any of this; tenant builds never do.

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
  error?: string;
  notifiedAt?: string;
}

interface HostingStore {
  invites: HostingInvite[];
  requests: HostingRequest[];
}

export const hostingEnabled = () =>
  env.ATMOBB_HOSTING === '1' && Boolean(env.DEPLOY_SESSION_TOKEN);
export const hostingDomainSuffix = () => env.ATMOBB_HOSTING_DOMAIN_SUFFIX ?? 'atmobb.app';
export const tenantDomain = (subdomain: string) => `${subdomain}.${hostingDomainSuffix()}`;
const deployApi = () => env.DEPLOY_API ?? 'https://admin.keith.is';
const tenantGitUrl = () => env.ATMOBB_HOSTING_GIT_URL ?? 'https://github.com/keithk/atmoBB.git';

const storePath = () => join(process.env.DATA_DIR ?? '.data', 'hosting.json');

async function loadStore(): Promise<HostingStore> {
  try {
    return JSON.parse(await readFile(storePath(), 'utf8'));
  } catch {
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

Hosted forums have no plugins and no members-only boards. If you
outgrow that, self-hosting is the same software:
https://github.com/keithk/atmoBB`;
}

async function dashboard<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${deployApi()}${path}`, {
    method,
    headers: {
      cookie: `session=${env.DEPLOY_SESSION_TOKEN}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`deploy API ${method} ${path}: ${res.status} ${detail}`.slice(0, 300));
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export const SUBDOMAIN_RULE =
  'Use 3–30 lowercase letters, numbers, or hyphens. Start and end with a letter or number.';
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
// Non-site names that must never become tenants. Collisions with existing
// dashboard sites are caught against the live site list at submit time.
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
  // Site-name collisions come from the dashboard, outside the store lock.
  let takenNames: Set<string>;
  try {
    const sites = await dashboard<{ name: string }[]>('GET', '/api/sites');
    takenNames = new Set(sites.map((s) => s.name));
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

/**
 * Provision an approved request through the deploy dashboard: create the
 * site, make it public with persistent storage, write the tenant env, and
 * deploy. Mirrors infra/provision-tenant.sh minus the Happyview client key,
 * which the runbook covers minting by hand. Safe to rerun after a failure.
 */
export function approveRequest(id: string): Promise<HostingRequest | null> {
  return withStore(async (store) => {
    const r = store.requests.find((q) => q.id === id);
    if (!r || (r.status !== 'pending' && r.status !== 'failed')) return r ?? null;
    try {
      if (!r.siteId) {
        const site = await dashboard<{ id: string }>('POST', '/api/sites', {
          name: r.subdomain,
          git_url: tenantGitUrl(),
          sleep_enabled: true,
          sleep_after_minutes: 60,
        });
        r.siteId = site.id;
      }
      await dashboard('PATCH', `/api/sites/${r.siteId}`, {
        visibility: 'public',
        persistent_storage: true,
        custom_domains: [tenantDomain(r.subdomain)],
      });
      const origin = `https://${tenantDomain(r.subdomain)}`;
      await dashboard('PATCH', `/api/sites/${r.siteId}/env`, {
        ORIGIN: origin,
        ATMOBB_APP_URL: origin,
        HAPPYVIEW_URL: env.HAPPYVIEW_URL ?? 'https://hv.atmobb.app',
        ATMOBB_FORUM_DID: r.forumDid,
        ATMOBB_COOKIE_SECRET: randomBytes(32).toString('hex'),
      });
      await dashboard('POST', `/api/sites/${r.siteId}/deploy`);
      r.status = 'provisioning';
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

/** Flip 'provisioning' requests to 'live' once their site serves the DID. */
export function checkProvisioning(): Promise<void> {
  return withStore(async (store) => {
    const waiting = store.requests.filter((r) => r.status === 'provisioning');
    await Promise.all(
      waiting.map(async (r) => {
        try {
          const res = await fetch(`https://${tenantDomain(r.subdomain)}/.well-known/atproto-did`, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok && (await res.text()) === r.forumDid) {
            r.status = 'live';
            if (r.email && !r.notifiedAt) {
              r.notifiedAt = new Date().toISOString();
              void sendMail(r.email, 'your forum is live', liveEmail(r));
            }
          }
        } catch {
          // still building, or asleep; the next admin page load checks again
        }
      }),
    );
  });
}
