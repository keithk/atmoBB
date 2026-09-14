import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CallContext } from '@extism/extism';
import type { LexiconDoc } from '@atproto/lexicon';
import { isValidDid } from '@atproto/syntax';
import { env } from '$env/dynamic/private';
import {
  HOST_FUNCTIONS,
  type ActionInput,
  type ExtensionManifest,
  type HostError,
  type HostFunctionName,
  type HostFunctionTypes,
  type HostResult,
  type MigrateInput,
  type NotifyPayload,
  type NotifyResult,
  type TimerSet,
  type ViewerContext,
} from '$lib/extensions/contract';
import { canModerateForum } from '../admin';
import { FORUM_DID, getBoardIndex } from '../appview';
import { forumStanding } from '../membership';
import { send } from '../notify/relay';
import { senderDid } from '../notify/sender';
import { readMember, setStatus } from '../notify/store';
import { getPublicProfile } from '../profiles';
import { bannedFrom } from '../standing';
import { KvQuotaError, kvDelete, kvGet, kvList, kvSet } from './kv';
import { extensionsLockHeld } from './lock';
import { extensionsEnabled } from './manifest';
import { RecordError, createRecord, deleteRecord, getRecord, listRecords, putRecord, type RecordInstall } from './records';
import { bundleDir, getInstall, type ExtensionInstall, type MigrationContext } from './registry';
import { ExtensionLimitError, extensionRuntime, type ExtensionModule, type GuestLogLevel, type HostFunction } from './runtime';
import { TimerCapExceededError, TimerDelayTooShortError, cancelTimer, scheduleTimer } from './scheduler';

// The one way into extension code. Every call is refused unless extensions are
// on and this process holds the extensions lock, runs one at a time per
// install, and is metered: host calls, bytes the guest hands the host, bytes
// the host hands back, and time spent waiting on host I/O. Host functions read
// the running call's budget from the call's host context.
//
// Nothing a guest supplies reaches the server's own output. Server log lines
// name the install, the export, the outcome, and the duration; the guest's
// console output and error text go to a small per-install log for admins.

export type ExtensionCallErrorCode =
  | 'unavailable'
  | 'not_installed'
  | 'disabled'
  | 'rate_limited'
  | 'no_handler'
  | 'timeout'
  | 'memory'
  | 'call_limit'
  | 'failed'
  | 'bad_output';

/** A call that was refused or didn't finish. Messages never carry guest text. */
export class ExtensionCallError extends Error {
  constructor(
    readonly code: ExtensionCallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionCallError';
  }
}

// --- limits ------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function envInt(name: string, fallback: number): number {
  const raw = env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** ATMOBB_EXTENSIONS_CALL_TIMEOUT_MS: wall-clock time for one call, host I/O included. */
const callTimeoutMs = () => envInt('ATMOBB_EXTENSIONS_CALL_TIMEOUT_MS', 5_000);
/** ATMOBB_EXTENSIONS_MEMORY_PAGES: guest memory ceiling, in 64 KiB pages. */
const memoryPages = () => envInt('ATMOBB_EXTENSIONS_MEMORY_PAGES', 1_024);

interface CallLimits {
  hostCalls: number;
  argBytes: number;
  returnBytes: number;
  ioMs: number;
}

function callLimits(): CallLimits {
  return {
    /** ATMOBB_EXTENSIONS_CALL_HOST_CALLS: host function calls per call. */
    hostCalls: envInt('ATMOBB_EXTENSIONS_CALL_HOST_CALLS', 100),
    /** ATMOBB_EXTENSIONS_CALL_ARG_BYTES: payload bytes the guest passes to host functions over one call. */
    argBytes: envInt('ATMOBB_EXTENSIONS_CALL_ARG_BYTES', 256 * 1024),
    /** ATMOBB_EXTENSIONS_CALL_RETURN_BYTES: bytes host functions return over one call, and bytes the export outputs. */
    returnBytes: envInt('ATMOBB_EXTENSIONS_CALL_RETURN_BYTES', 1024 * 1024),
    // ATMOBB_EXTENSIONS_HOST_IO_MS: time spent waiting on host functions over
    // one call. The runtime's timeout counts that waiting too, so this stays
    // below it and a slow host call fails as a metered limit, not a timeout.
    ioMs: Math.min(envInt('ATMOBB_EXTENSIONS_HOST_IO_MS', 3_000), Math.floor(callTimeoutMs() * 0.8)),
  };
}

/** ATMOBB_EXTENSIONS_RECORD_WRITES_PER_HOUR: creates, puts, and deletes per install, well under the PDS's own write limit. */
const recordWritesPerHour = () => envInt('ATMOBB_EXTENSIONS_RECORD_WRITES_PER_HOUR', 100);
/** ATMOBB_EXTENSIONS_NOTIFY_PER_RECIPIENT_PER_DAY: notifications one install sends one member per day. */
const notifyPerRecipientPerDay = () => envInt('ATMOBB_EXTENSIONS_NOTIFY_PER_RECIPIENT_PER_DAY', 5);
/** ATMOBB_EXTENSIONS_NOTIFY_PER_INSTALL_PER_DAY: notifications one install sends per day. */
const notifyPerInstallPerDay = () => envInt('ATMOBB_EXTENSIONS_NOTIFY_PER_INSTALL_PER_DAY', 100);
/** ATMOBB_EXTENSIONS_ACTIONS_PER_VIEWER_PER_MINUTE: actions one viewer (or all signed-out viewers together) runs on one install. */
const actionsPerViewerPerMinute = () => envInt('ATMOBB_EXTENSIONS_ACTIONS_PER_VIEWER_PER_MINUTE', 30);
/** ATMOBB_EXTENSIONS_ACTIONS_PER_INSTALL_PER_MINUTE: actions one install runs. */
const actionsPerInstallPerMinute = () => envInt('ATMOBB_EXTENSIONS_ACTIONS_PER_INSTALL_PER_MINUTE', 300);

const MAX_NOTIFY_RECIPIENTS = 50;
const NOTIFY_TITLE_MAX = 100;
const NOTIFY_BODY_MAX = 500;

// Sliding windows of event times, in memory. A restart forgets them, which
// errs toward allowing; the PDS and relay keep their own limits.
let windows = new Map<string, number[]>();

/** Take a slot in the window `key`, or return false when `limit` slots in the last `spanMs` are taken. */
function takeSlot(key: string, limit: number, spanMs: number, now = Date.now()): boolean {
  const recent = (windows.get(key) ?? []).filter((at) => now - at < spanMs);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  return true;
}

const slotsLeft = (key: string, limit: number, spanMs: number, now = Date.now()) =>
  limit - (windows.get(key) ?? []).filter((at) => now - at < spanMs).length;

// --- install log -------------------------------------------------------------

export interface ExtensionLogLine {
  at: string;
  level: GuestLogLevel;
  text: string;
}

const LOG_LINES = 200;
const LOG_LINE_CHARS = 500;
let logs = new Map<string, ExtensionLogLine[]>();

function appendLog(installId: string, level: GuestLogLevel, text: string) {
  const lines = logs.get(installId) ?? [];
  lines.push({ at: new Date().toISOString(), level, text: text.length > LOG_LINE_CHARS ? `${text.slice(0, LOG_LINE_CHARS - 1)}…` : text });
  if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES);
  logs.set(installId, lines);
}

/** The install's recent console output and errors, oldest first, for admins. */
export const extensionLog = (installId: string): ExtensionLogLine[] => [...(logs.get(installId) ?? [])];

export function resetHostLimitsForTests() {
  windows = new Map();
  logs = new Map();
}

// --- host functions ------------------------------------------------------------

class CallBudget {
  hostCalls = 0;
  argBytes = 0;
  returnBytes = 0;
  ioMs = 0;
  /** The first limit the call went past. */
  exceeded: string | null = null;

  constructor(readonly limits: CallLimits) {}

  exceed(limit: string): HostResult<never> {
    this.exceeded ??= limit;
    return failure('call_limit', `This call went past its ${this.exceeded} limit`);
  }
}

/** A refusal whose message is safe to hand the guest. */
class HostCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const failure = (code: string, message: string): HostResult<never> => ({ ok: false, error: { code, message } satisfies HostError });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function requireStrings(payload: Record<string, unknown>, ...fields: string[]) {
  for (const field of fields) {
    if (typeof payload[field] !== 'string') throw new HostCallError('invalid_payload', `${field} must be a string`);
  }
}

/** The error a guest sees when a host operation throws. Unexpected errors say only which function failed. */
function hostFailure(name: HostFunctionName, error: unknown): HostResult<never> {
  if (error instanceof HostCallError || error instanceof KvQuotaError || error instanceof RecordError) {
    return failure(error.code, error.message);
  }
  if (error instanceof TimerDelayTooShortError) return failure('timer_too_soon', error.message);
  if (error instanceof TimerCapExceededError) return failure('too_many_timers', 'This extension already has as many pending timers as it may');
  return failure('host_error', `The host couldn't complete ${name}`);
}

const IO_TIMEOUT = Symbol('io timeout');

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof IO_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Work that loses the race still settles later; its outcome is dropped.
  work.catch(() => {});
  return Promise.race([work, new Promise<typeof IO_TIMEOUT>((resolve) => (timer = setTimeout(() => resolve(IO_TIMEOUT), ms)))]).finally(() =>
    clearTimeout(timer),
  );
}

type HostOp<K extends HostFunctionName> = (payload: HostFunctionTypes[K][0] & Record<string, unknown>) => Promise<HostFunctionTypes[K][1]>;
type HostOps = { [K in HostFunctionName]: HostOp<K> };

async function answer(name: HostFunctionName, op: HostOp<HostFunctionName> | null, context: CallContext, ptr: bigint): Promise<HostResult<unknown>> {
  const budget = context.hostContext<CallBudget | undefined>();
  if (!(budget instanceof CallBudget)) return failure('host_error', 'No call is running');
  if (budget.exceeded) return budget.exceed(budget.exceeded);
  if (++budget.hostCalls > budget.limits.hostCalls) return budget.exceed('host call');
  // Measured before the payload is copied out of guest memory.
  budget.argBytes += Number(context.length(ptr));
  if (budget.argBytes > budget.limits.argBytes) return budget.exceed('argument size');
  if (!op) return failure('capability_not_granted', `${name} needs the ${HOST_FUNCTIONS[name]} capability, which this extension wasn't granted`);

  let payload: unknown;
  try {
    payload = JSON.parse(context.read(ptr)?.text() ?? '');
  } catch {
    return failure('invalid_payload', `${name} takes a JSON object`);
  }
  if (!isObject(payload)) return failure('invalid_payload', `${name} takes a JSON object`);

  const left = budget.limits.ioMs - budget.ioMs;
  if (left <= 0) return budget.exceed('host I/O time');
  const started = performance.now();
  try {
    const value = await withDeadline(op(payload as never), left);
    if (value === IO_TIMEOUT) return budget.exceed('host I/O time');
    return { ok: true, value: value ?? null };
  } catch (error) {
    return hostFailure(name, error);
  } finally {
    budget.ioMs += performance.now() - started;
  }
}

function hostFunction(name: HostFunctionName, op: HostOp<HostFunctionName> | null): HostFunction {
  return async (context: CallContext, ptr: bigint) => {
    const reply = await answer(name, op, context, ptr);
    let text = JSON.stringify(reply);
    const budget = context.hostContext<CallBudget | undefined>();
    if (reply.ok && budget instanceof CallBudget) {
      budget.returnBytes += Buffer.byteLength(text);
      if (budget.returnBytes > budget.limits.returnBytes) text = JSON.stringify(budget.exceed('return size'));
    }
    return context.store(text);
  };
}

function hostOps(installId: string, manifest: ExtensionManifest, records: RecordInstall): HostOps {
  const writeRecord = <T>(write: () => Promise<T>) => {
    if (!takeSlot(`records|${installId}`, recordWritesPerHour(), HOUR_MS)) {
      throw new HostCallError('rate_limited', `This extension may write ${recordWritesPerHour()} records an hour`);
    }
    return write();
  };
  return {
    kv_get: (p) => {
      requireStrings(p, 'key');
      return kvGet(installId, p);
    },
    kv_set: async (p) => {
      requireStrings(p, 'key');
      await kvSet(installId, p);
      return null;
    },
    kv_delete: async (p) => {
      requireStrings(p, 'key');
      await kvDelete(installId, p);
      return null;
    },
    kv_list: (p) => {
      requireStrings(p, 'prefix');
      if (p.limit !== undefined && !(Number.isInteger(p.limit) && p.limit > 0)) throw new HostCallError('invalid_payload', 'limit must be a positive integer');
      if (p.cursor !== undefined) requireStrings(p, 'cursor');
      return kvList(installId, p);
    },
    record_create: (p) => writeRecord(() => createRecord(records, p)),
    record_put: (p) => writeRecord(() => putRecord(records, p)),
    record_delete: async (p) => {
      await writeRecord(() => deleteRecord(records, p));
      return null;
    },
    record_list: (p) => listRecords(records, p),
    record_get: (p) => getRecord(records, p),
    timer_set: async (p) => {
      requireStrings(p, 'name', 'at');
      if (!Number.isFinite(Date.parse(p.at))) throw new HostCallError('invalid_payload', 'at must be an ISO 8601 datetime');
      await scheduleTimer(installId, { name: p.name, at: p.at, payload: p.payload });
      return null;
    },
    timer_cancel: async (p) => {
      requireStrings(p, 'name');
      await cancelTimer(installId, p.name);
      return null;
    },
    notify: (p) => notify(installId, manifest.name, p),
  };
}

// --- notify ------------------------------------------------------------------

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The absolute URL for a link on the forum, or an error for anything that leaves it. */
function forumLink(link: unknown): string {
  const refused = new HostCallError('invalid_link', 'Links must be paths on the forum');
  if (typeof link !== 'string' || !env.ATMOBB_APP_URL) throw refused;
  const origin = new URL(env.ATMOBB_APP_URL).origin;
  if (!link.startsWith('/') && !link.startsWith(`${origin}/`)) throw refused;
  let url: URL;
  try {
    url = new URL(link, origin);
  } catch {
    throw refused;
  }
  // A path like //elsewhere.example or /\elsewhere.example parses to another host.
  if (url.origin !== origin) throw refused;
  return url.href;
}

const canHear = (standing: string) => standing === 'open' || standing === 'member';

/**
 * Send through the relay as the forum, to members who turned notifications
 * on. Recipients who haven't, or who are past their daily cap, are skipped
 * without saying which.
 */
async function notify(installId: string, extensionName: string, payload: Record<string, unknown>): Promise<NotifyResult> {
  const { to, title, message } = payload as Partial<NotifyPayload>;
  if (!Array.isArray(to) || to.length > MAX_NOTIFY_RECIPIENTS) {
    throw new HostCallError('invalid_payload', `to must be a list of at most ${MAX_NOTIFY_RECIPIENTS} DIDs`);
  }
  requireStrings(payload, 'title', 'message');
  const uri = payload.link === undefined ? undefined : forumLink(payload.link);
  if (!senderDid()) throw new HostCallError('notify_unavailable', "This forum isn't set up to send notifications");

  const installKey = `notify|${installId}`;
  if (slotsLeft(installKey, notifyPerInstallPerDay(), DAY_MS) <= 0) {
    throw new HostCallError('rate_limited', `This extension may send ${notifyPerInstallPerDay()} notifications a day`);
  }
  const profile = (await getBoardIndex(FORUM_DID())).forum;
  let sent = 0;
  for (const did of new Set(to)) {
    if (typeof did !== 'string' || !isValidDid(did)) continue;
    const [{ standing }, member] = await Promise.all([forumStanding(did, profile, { strict: true }), readMember(did)]);
    if (!canHear(standing) || member?.status !== 'on') continue;
    if ((await getPublicProfile(did, undefined, true))?.notifications === false) continue;
    const recipientKey = `notify|${installId}|${did}`;
    if (slotsLeft(recipientKey, notifyPerRecipientPerDay(), DAY_MS) <= 0) continue;
    if (!takeSlot(installKey, notifyPerInstallPerDay(), DAY_MS)) break;
    takeSlot(recipientKey, notifyPerRecipientPerDay(), DAY_MS);
    const result = await send({
      recipient: did,
      title: cut(`${extensionName}: ${title}`, NOTIFY_TITLE_MAX),
      body: cut(message!, NOTIFY_BODY_MAX),
      ...(uri ? { uri } : {}),
    });
    if (result.ok) sent += 1;
    // Only the relay saying there is no grant turns a member off.
    else if (result.status === 403 && result.error === 'NotAuthorized') await setStatus(did, 'off');
  }
  return { sent };
}

// --- modules and the runtime -----------------------------------------------------

async function moduleFor(installId: string, manifest: ExtensionManifest, dir: string): Promise<ExtensionModule> {
  const lexicons: LexiconDoc[] = await Promise.all(
    manifest.lexicons.map(async (path) => JSON.parse(await readFile(join(dir, ...path.split('/')), 'utf8'))),
  );
  const ops = hostOps(installId, manifest, { collections: new Set(manifest.collections), lexicons });
  const granted = new Set(manifest.capabilities);
  // Every host function is importable, since a module importing one the host
  // didn't provide couldn't start at all; ungranted ones only refuse.
  const functions = Object.fromEntries(
    (Object.keys(HOST_FUNCTIONS) as HostFunctionName[]).map((name) => [
      name,
      hostFunction(name, granted.has(HOST_FUNCTIONS[name]) ? (ops[name] as HostOp<HostFunctionName>) : null),
    ]),
  );
  return { wasm: join(dir, 'extension.wasm'), functions, log: (level, text) => appendLog(installId, level, text) };
}

/** The release each install's live instance was loaded from. */
const loadedSha = new Map<string, string>();

async function loadInstall(installId: string): Promise<ExtensionModule> {
  const install = await getInstall(installId);
  if (!install) throw new ExtensionCallError('not_installed', 'No such extension install');
  loadedSha.set(installId, install.sha);
  return moduleFor(installId, install.manifest, bundleDir(install));
}

let runtime: ReturnType<typeof extensionRuntime> | null = null;
const rt = () => (runtime ??= extensionRuntime(loadInstall, { timeoutMs: callTimeoutMs(), memoryPages: memoryPages() }));

/** Close every live instance. */
export async function closeExtensionHost(): Promise<void> {
  const closing = runtime;
  runtime = null;
  loadedSha.clear();
  await closing?.close();
}

function refuseUnlessRunning() {
  if (!extensionsEnabled() || !extensionsLockHeld()) {
    throw new ExtensionCallError('unavailable', 'Extensions are not running on this server');
  }
}

async function installFor(installId: string, requireActive: boolean): Promise<ExtensionInstall> {
  const install = await getInstall(installId);
  if (!install) throw new ExtensionCallError('not_installed', 'No such extension install');
  if (requireActive && install.state !== 'active') throw new ExtensionCallError('disabled', `${install.manifest.name} is disabled`);
  return install;
}

const failureLabel = (error: unknown) => (error instanceof ExtensionCallError ? error.code : 'failed');

/** Run an export under a fresh budget. Null when the module doesn't export it. */
async function runCall(install: ExtensionInstall, name: string, input: unknown, module?: ExtensionModule): Promise<string | null> {
  const started = performance.now();
  try {
    // An update or rollback moved the install to another release since its instance loaded.
    const loaded = loadedSha.get(install.id);
    if (!module && loaded !== undefined && loaded !== install.sha) await rt().evict(install.id);
    const budget = new CallBudget(callLimits());
    let output: string | null;
    try {
      output = await rt().call(install.id, name, JSON.stringify(input), { hostContext: budget, maxOutputBytes: budget.limits.returnBytes, module });
    } catch (error) {
      if (error instanceof ExtensionCallError) throw error;
      if (error instanceof ExtensionLimitError) {
        if (error.limit === 'output') throw new ExtensionCallError('call_limit', 'The extension went past its return size limit');
        throw new ExtensionCallError(error.limit, `The extension went past its ${error.limit === 'timeout' ? 'time' : 'memory'} limit`);
      }
      appendLog(install.id, 'error', error instanceof Error ? error.message : String(error));
      throw new ExtensionCallError('failed', 'The extension failed while handling the call');
    }
    if (budget.exceeded) throw new ExtensionCallError('call_limit', `The extension went past its ${budget.exceeded} limit`);
    return output;
  } catch (error) {
    console.warn(`[extensions] ${install.id} ${name} ${failureLabel(error)} after ${Math.round(performance.now() - started)}ms`);
    throw error;
  }
}

function parseOutput(output: string): unknown {
  if (output === '') return null;
  try {
    return JSON.parse(output);
  } catch {
    throw new ExtensionCallError('bad_output', "The extension's output isn't JSON");
  }
}

// --- entry points ------------------------------------------------------------------

/** Who the viewer is, from the session's DID only. */
export async function viewerContext(did: string | null): Promise<ViewerContext> {
  if (!did) return { did: null, standing: 'nonmember', staff: false, banned: false };
  const profile = (await getBoardIndex(FORUM_DID())).forum;
  const [{ standing }, staff, ban] = await Promise.all([
    forumStanding(did, profile, { strict: true }),
    canModerateForum(did),
    bannedFrom(did, undefined, { strict: true }),
  ]);
  return { did, standing, staff, banned: !!ban };
}

/**
 * Run an install's `action` for a viewer. `viewerDid` must come from the
 * session; the handler is told the viewer's standing, staff role, and ban
 * status as the forum sees them. Resolves to the handler's JSON output.
 */
export async function dispatchAction(installId: string, viewerDid: string | null, action: string, input: unknown): Promise<unknown> {
  refuseUnlessRunning();
  const install = await installFor(installId, true);
  const viewerKey = viewerDid ?? 'anonymous';
  if (
    slotsLeft(`actions|${installId}|${viewerKey}`, actionsPerViewerPerMinute(), MINUTE_MS) <= 0 ||
    !takeSlot(`actions|${installId}`, actionsPerInstallPerMinute(), MINUTE_MS)
  ) {
    throw new ExtensionCallError('rate_limited', 'Too many actions; try again in a minute');
  }
  takeSlot(`actions|${installId}|${viewerKey}`, actionsPerViewerPerMinute(), MINUTE_MS);
  const viewer = await viewerContext(viewerDid);
  const output = await runCall(install, 'action', { viewer, action, input } satisfies ActionInput);
  if (output === null) throw new ExtensionCallError('no_handler', `${install.manifest.name} has no action handler`);
  return parseOutput(output);
}

/** The scheduler's dispatcher: run an install's `timer`, or nothing when it has none. */
export async function dispatchTimer(installId: string, timer: TimerSet): Promise<void> {
  refuseUnlessRunning();
  const install = await installFor(installId, true);
  await runCall(install, 'timer', timer);
}

/** Whether the install reports work in progress, for disable and uninstall. False when it exports no `openWork`. */
export async function openWork(installId: string): Promise<boolean> {
  refuseUnlessRunning();
  const install = await installFor(installId, false);
  const output = await runCall(install, 'openWork', null);
  return output !== null && parseOutput(output) === true;
}

/**
 * The registry's update hook: when the new release raises the data version,
 * run its `migrate` over the install's data before the install switches to it.
 */
export async function migrate({ install, from, to }: MigrationContext): Promise<void> {
  refuseUnlessRunning();
  if (to.manifest.dataVersion <= from.manifest.dataVersion) return;
  const module = await moduleFor(install.id, to.manifest, to.dir);
  const input: MigrateInput = { from: from.manifest.dataVersion, to: to.manifest.dataVersion };
  await runCall(install, 'migrate', input, module);
}
