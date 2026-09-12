import type { Agent } from '@atproto/api';
import { RELAY_AUD, requestPermission, type PermissionInput, type PermissionResult } from './relay';
import { senderDid } from './sender';
import { confirmPending, readMember, setStatus, type MemberNotifyState } from './store';

// Turning notifications on: the member asks atmo.pub, in the forum's name,
// to deliver to them. The member's own service token carries that request,
// so it only ever lives in this request's memory. Dependencies are injected
// so the flow is testable without a PDS or the relay.

export const REQUEST_PERMISSION_LXM = 'pub.atmo.notify.requestPermission';
// KTD12: pressing turn on again while pending waits this long after changedAt.
const RETRY_COOLDOWN_MS = 10 * 60_000;
// KTD14: a pending member is re-checked against the relay at most this often.
const RECHECK_INTERVAL_MS = 60_000;
const TOKEN_TTL_SECONDS = 60;

export interface OptInDeps {
  senderDid: string;
  // Mints the member's service token for the relay; throws when the PDS
  // refuses (a stale consent) or cannot be reached.
  getServiceAuth: (did: string) => Promise<string>;
  requestPermission: (userToken: string, input: PermissionInput) => Promise<PermissionResult>;
  store: {
    readMember: (did: string) => Promise<MemberNotifyState | null>;
    setStatus: (did: string, status: MemberNotifyState['status']) => Promise<void>;
    confirmPending: (did: string) => Promise<void>;
  };
}

// What the relay shows the member on its approval screen.
export interface PermissionDetails {
  forumName: string;
  description?: string;
  iconUrl?: string;
}

// One description everywhere the forum introduces itself to atmo.pub.
export function forumPermissionDetails(forumName: string, iconUrl?: string | null): PermissionDetails {
  return {
    forumName,
    description: `Replies, mentions, and new threads in boards you watch on ${forumName}.`,
    ...(iconUrl ? { iconUrl } : {}),
  };
}

export type EnableOutcome =
  | { outcome: 'on' }
  | { outcome: 'pending' }
  | { outcome: 'reconsent' }
  | { outcome: 'pds-error'; message: string }
  | { outcome: 'relay-error'; message: string };

export function canRetryTurnOn(member: MemberNotifyState | null, nowMs: number): boolean {
  if (!member || member.status !== 'pending') return true;
  return nowMs - Date.parse(member.changedAt) >= RETRY_COOLDOWN_MS;
}

// A refusal to mint the token means the session's consent predates the
// permission set; anything else is the PDS being unreachable.
function isConsentRefusal(err: unknown): boolean {
  const text = [
    err instanceof Error ? err.message : String(err),
    typeof (err as { error?: unknown })?.error === 'string' ? (err as { error: string }).error : '',
  ].join(' ');
  return /scope|permission|InvalidToken|not authorized/i.test(text);
}

function permissionInput(senderDid: string, details: PermissionDetails): PermissionInput {
  return {
    senderDid,
    title: details.forumName.slice(0, 50),
    ...(details.description ? { description: details.description } : {}),
    ...(details.iconUrl?.startsWith('https://') ? { iconUrl: details.iconUrl } : {}),
  };
}

export async function enableNotifications({
  did,
  deps,
  ...details
}: PermissionDetails & { did: string; deps: OptInDeps }): Promise<EnableOutcome> {
  await deps.store.setStatus(did, 'pending');
  let token: string;
  try {
    token = await deps.getServiceAuth(did);
  } catch (err) {
    await deps.store.setStatus(did, 'off');
    console.warn('[notify] getServiceAuth failed:', err instanceof Error ? err.message : err);
    if (isConsentRefusal(err)) return { outcome: 'reconsent' };
    return { outcome: 'pds-error', message: "Couldn't reach your account's server. Try again." };
  }
  const result = await deps.requestPermission(token, permissionInput(deps.senderDid, details));
  if ('error' in result) {
    console.warn(`[notify] requestPermission failed: ${result.status} ${result.error}`);
    await deps.store.setStatus(did, 'off');
    return { outcome: 'relay-error', message: "atmo.pub didn't answer. Try again in a minute." };
  }
  if (result.status === 'alreadyGranted') {
    await deps.store.setStatus(did, 'on');
    return { outcome: 'on' };
  }
  await deps.store.confirmPending(did);
  return { outcome: 'pending' };
}

// Last re-check per member, forum clock. Grows with the member count only.
let lastRecheck = new Map<string, number>();

export function resetOptInForTests() {
  lastRecheck = new Map();
}

// KTD14: while pending, ask the relay again; alreadyGranted means the member
// approved in atmo.pub and nobody told us. Never touches status otherwise,
// and never throws, since it runs inside page loads.
export async function recheckPending({
  did,
  deps,
  nowMs = Date.now(),
  ...details
}: PermissionDetails & { did: string; deps: OptInDeps; nowMs?: number }): Promise<void> {
  const member = await deps.store.readMember(did);
  if (member?.status !== 'pending') return;
  const last = lastRecheck.get(did);
  if (last !== undefined && nowMs - last < RECHECK_INTERVAL_MS) return;
  lastRecheck.set(did, nowMs);
  try {
    const token = await deps.getServiceAuth(did);
    const result = await deps.requestPermission(token, permissionInput(deps.senderDid, details));
    if ('error' in result) {
      console.warn(`[notify] pending re-check failed: ${result.status} ${result.error}`);
    } else if (result.status === 'alreadyGranted') {
      await deps.store.setStatus(did, 'on');
    }
  } catch (err) {
    console.warn('[notify] pending re-check failed:', err instanceof Error ? err.message : err);
  }
}

// The live wiring. `agentFor` is passed in because the OAuth module reads
// private env at import time and cannot be loaded by tests.
export function optInDeps(agentFor: (did: string) => Promise<Agent>): OptInDeps | null {
  const sender = senderDid();
  if (!sender) return null;
  return {
    senderDid: sender,
    getServiceAuth: async (did) => {
      const agent = await agentFor(did);
      const res = await agent.com.atproto.server.getServiceAuth({
        aud: RELAY_AUD,
        lxm: REQUEST_PERMISSION_LXM,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      });
      return res.data.token;
    },
    requestPermission,
    store: { readMember, setStatus, confirmPending },
  };
}
