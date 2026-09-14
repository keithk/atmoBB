import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import type { LexiconDoc } from '@atproto/lexicon';
import type { ExtensionManifest } from '$lib/extensions/contract';
import { claimCollections, claimConflicts, newInstallId, normalizeGitUrl } from './claims';
import { ReleaseError, listRemoteTags, readRelease, type Release, type ReleaseSource, type RemoteTag } from './fetch';
import { extensionsLockHeld } from './lock';
import { admitExtension, checkPublishedLexicons, type LexiconResolver, type PublishedLexiconCheck } from './manifest';
import { beforeDeadline } from './deadline';
import { KV_UNINSTALL_GRACE_MS } from './kv';

// Every installed extension, the release it runs, and the releases it ran
// before. An install stays on its release until an admin moves it: installing
// and updating are both two steps, stage (fetch, admit, and show the admin
// what they're approving) then confirm. Bundles live at
// DATA_DIR/extensions/<install id>/<sha>/, and earlier releases' bundles stay
// on disk so an admin can roll back.

export type InstallState = 'active' | 'disabled';

export interface ReleaseRecord {
  /** Null for a local directory. */
  tag: string | null;
  sha: string;
  version: string;
  dataVersion: number;
  installedAt: string;
}

export interface ExtensionInstall {
  id: string;
  /** As the admin entered it. */
  gitUrl: string;
  /** The claims key, one per repository. */
  normalizedUrl: string;
  source: ReleaseSource;
  tag: string | null;
  /** The commit SHA, or for a local directory, the content hash. */
  sha: string;
  state: InstallState;
  manifest: ExtensionManifest;
  /** Every release this install has run, oldest first. */
  history: ReleaseRecord[];
  installedAt: string;
  updatedAt: string;
}

/** A fetched, admitted release waiting for the admin to confirm it. */
export interface StagedRelease {
  stagingId: string;
  /** The install this release would update, or null for a new install. */
  installId: string | null;
  gitUrl: string;
  normalizedUrl: string;
  source: ReleaseSource;
  tag: string | null;
  sha: string;
  manifest: ExtensionManifest;
  stagedAt: string;
}

/** What the admin reviews before confirming. */
export interface InstallReview extends StagedRelease {
  authority: string | null;
  collections: string[];
  /** The OAuth scope the collections add to the forum login. */
  scope: string;
  lexicons: LexiconDoc[];
  /** Null when the extension declares no collections. */
  published: PublishedLexiconCheck | null;
  files: { path: string; bytes: number }[];
  /** A new install that picks up the private data an earlier install of this repository left, inside the uninstall grace period and at the same data version. */
  restoresData: boolean;
}

export interface InstallProblem {
  field: string;
  message: string;
}

export type Refused = { ok: false; errors: InstallProblem[] };
export type StageResult = { ok: true; review: InstallReview } | Refused;
export type InstallResult = { ok: true; install: ExtensionInstall } | Refused;

export interface StageOptions {
  /** Where published lexicons are looked up; defaults to DNS and the network. */
  lexiconResolver?: LexiconResolver;
}

export interface StopOptions {
  /** Go ahead even when the extension reports open work. */
  force?: boolean;
  hasOpenWork?: (install: ExtensionInstall) => boolean | Promise<boolean>;
}

export interface MigrationContext {
  install: ExtensionInstall;
  from: { tag: string | null; sha: string; manifest: ExtensionManifest; dir: string };
  to: { tag: string | null; sha: string; manifest: ExtensionManifest; dir: string };
  /**
   * Aborts when the update gives up on the migration: `migrate` threw or ran
   * past its deadline. The migration may not have started yet, or may still be
   * running. From then on it must not write, and whatever it already wrote to
   * the install's k/v store is its own to put back.
   */
  signal: AbortSignal;
}

export interface UpdateOptions {
  /**
   * Runs with the new bundle in place and the registry locked, before the
   * install switches over. Throwing, or running past `migrateTimeoutMs`, keeps
   * the previous release active and aborts the context's signal; the update
   * doesn't touch the install's k/v store itself. It must not call registry
   * mutations.
   */
  migrate?: (context: MigrationContext) => void | Promise<void>;
  /** How long `migrate` may run before the update is refused; defaults to MIGRATE_TIMEOUT_MS. */
  migrateTimeoutMs?: number;
}

export interface ChangedTag {
  tag: string;
  installedSha: string;
  currentSha: string;
}

export type UpdateListing = { ok: true; newer: RemoteTag[]; changed: ChangedTag[] } | Refused;

/** Staged releases nobody confirmed are removed after this long. */
export const STAGING_TTL_MS = 60 * 60_000;

/**
 * How long an update's migration may hold the registry. Well past the
 * runtime's watchdog on one call (11 seconds at the default 5-second call
 * timeout), so a migration call that times out fails as its own error first.
 */
export const MIGRATE_TIMEOUT_MS = 60_000;

const STAGING_ID = /^[A-Za-z0-9_-]{22}$/;

const refused = (field: string, message: string): Refused => ({ ok: false, errors: [{ field, message }] });
const shortSha = (sha: string) => sha.slice(0, 12);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// --- paths and the store ----------------------------------------------------------

const extensionsRoot = () => join(process.env.DATA_DIR ?? '.data', 'extensions');
const storePath = () => join(extensionsRoot(), 'registry.json');
const stagingDir = (stagingId: string) => join(extensionsRoot(), '.staging', stagingId);

/** Where an install's active bundle lives. */
export const bundleDir = (install: Pick<ExtensionInstall, 'id' | 'sha'>) => join(extensionsRoot(), install.id, install.sha);

export interface Uninstalled {
  installId: string;
  uninstalledAt: string;
  /** The repository it was installed from, so a reinstall inside the grace period picks its data back up. Entries without one never match. */
  normalizedUrl?: string;
  /** The data version its release stored data at. A reinstall picks the data back up only at this version; entries without one never match. */
  dataVersion?: number;
}

interface RegistryStore {
  installs: ExtensionInstall[];
  /** Removed installs whose private data still waits out the uninstall grace period. */
  uninstalled?: Uninstalled[];
}

async function readStore(path: string): Promise<RegistryStore> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { installs: [] };
  }
}

// Page views read the store several times each, so reads come from a parsed
// copy in memory, keyed by the file it came from. Only while this process
// holds the extensions lock: then every write to the file goes through
// saveStore here. A process without the lock reads the file every time, since
// the process that holds it may be writing.
let cached: { path: string; store: RegistryStore } | null = null;
/** Counts saves, so a read that overlapped one doesn't cache what it read. */
let saves = 0;

/** The store, as a copy the caller may change. */
async function loadStore(): Promise<RegistryStore> {
  const path = storePath();
  if (!extensionsLockHeld()) {
    cached = null;
    return readStore(path);
  }
  if (cached?.path === path) return structuredClone(cached.store);
  const savesBefore = saves;
  const store = await readStore(path);
  if (saves === savesBefore && extensionsLockHeld()) cached = { path, store: structuredClone(store) };
  return store;
}

/** Test-only: forget the in-memory store, for tests that write registry.json themselves. */
export function resetRegistryCacheForTests() {
  cached = null;
}

async function saveStore(store: RegistryStore) {
  const path = storePath();
  const text = JSON.stringify(store, null, 2);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
  saves += 1;
  cached = extensionsLockHeld() ? { path, store: JSON.parse(text) } : null;
}

// One mutation at a time; the store is a single JSON file. A mutation always
// starts from the file, never the in-memory copy.
let chain: Promise<unknown> = Promise.resolve();
function withStore<T>(fn: (store: RegistryStore) => Promise<T> | T): Promise<T> {
  const run = chain.then(async () => {
    const store = await readStore(storePath());
    const out = await fn(store);
    await saveStore(store);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

const exists = (path: string) => stat(path).then(() => true, () => false);

export const listInstalls = () => loadStore().then((store) => store.installs);

export const listUninstalled = () => loadStore().then((store) => store.uninstalled ?? []);

/** Stop tracking uninstalled installs whose private data has been purged. */
export const forgetUninstalled = (installIds: string[]) =>
  withStore((store) => {
    store.uninstalled = (store.uninstalled ?? []).filter((entry) => !installIds.includes(entry.installId));
  });

/**
 * The latest uninstall of this repository whose private data is still inside
 * the grace period, for a reinstall to pick back up, or null when that data is
 * at a data version other than `dataVersion`. A reinstall never runs migrate,
 * so it can only take data already at the version its release reads.
 */
function reusableUninstall(uninstalled: Uninstalled[], normalizedUrl: string, dataVersion: number, now = Date.now()): Uninstalled | null {
  const latest = uninstalled.findLast((entry) => entry.normalizedUrl === normalizedUrl && now - Date.parse(entry.uninstalledAt) < KV_UNINSTALL_GRACE_MS);
  return latest?.dataVersion === dataVersion ? latest : null;
}

export const getInstall = (id: string) => loadStore().then((store) => store.installs.find((install) => install.id === id) ?? null);

// --- staging ----------------------------------------------------------------------

async function writeBundle(dir: string, files: Map<string, Uint8Array>) {
  const root = resolve(dir);
  for (const [path, bytes] of files) {
    const target = resolve(root, ...path.split('/'));
    if (!target.startsWith(root + sep)) throw new Error(`Refused to write ${path} outside the bundle`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

async function sweepStaging() {
  const parent = join(extensionsRoot(), '.staging');
  let entries: string[];
  try {
    entries = await readdir(parent);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(parent, entry);
    const info = await stat(path).catch(() => null);
    if (info && Date.now() - info.mtimeMs > STAGING_TTL_MS) await rm(path, { recursive: true, force: true });
  }
}

async function readStaged(stagingId: string): Promise<StagedRelease | null> {
  if (!STAGING_ID.test(stagingId)) return null;
  try {
    return JSON.parse(await readFile(join(stagingDir(stagingId), 'stage.json'), 'utf8'));
  } catch {
    return null;
  }
}

const stagingGone = () => refused('stagingId', 'That staged release is no longer available. Fetch it again.');

const alreadyInstalled = (install: ExtensionInstall) =>
  refused('gitUrl', `${install.normalizedUrl} is already installed as ${install.manifest.name}. Update that install instead.`);

async function stage(
  target: { installId: string | null; gitUrl: string; normalizedUrl: string; tag: string | null; activeSha?: string },
  options: StageOptions,
): Promise<StageResult> {
  let release: Release;
  try {
    release = await readRelease(target.gitUrl, target.tag);
  } catch (error) {
    if (error instanceof ReleaseError) return refused('release', error.message);
    throw error;
  }
  if (release.sha === target.activeSha) return refused('release', `Release ${shortSha(release.sha)} is already active`);

  const decoder = new TextDecoder();
  const lexiconFiles = Object.fromEntries(
    [...release.files].filter(([path]) => path.endsWith('.json')).map(([path, bytes]) => [path, decoder.decode(bytes)]),
  );
  const admission = admitExtension(release.manifest, lexiconFiles);
  if (!admission.ok) return { ok: false, errors: admission.errors };

  const conflicts = await claimConflicts(target.normalizedUrl, admission.collections);
  if (conflicts.length) {
    return {
      ok: false,
      errors: conflicts.map(({ collection, heldBy }) => ({
        field: 'collections',
        message: `${collection} belongs to ${heldBy}, which declared it first`,
      })),
    };
  }

  const published = admission.authority ? await checkPublishedLexicons(admission.authority, admission.lexicons, options.lexiconResolver) : null;
  if (published?.status === 'refused') return refused('lexicons', published.error);

  await sweepStaging();
  const staged: StagedRelease = {
    stagingId: newInstallId(),
    installId: target.installId,
    gitUrl: target.gitUrl,
    normalizedUrl: target.normalizedUrl,
    source: release.source,
    tag: release.tag,
    sha: release.sha,
    manifest: admission.manifest,
    stagedAt: new Date().toISOString(),
  };
  const dir = stagingDir(staged.stagingId);
  try {
    await writeBundle(join(dir, 'bundle'), release.files);
    await writeFile(join(dir, 'stage.json'), JSON.stringify(staged, null, 2));
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  return {
    ok: true,
    review: {
      ...staged,
      authority: admission.authority,
      collections: admission.collections,
      scope: admission.scope,
      lexicons: admission.lexicons,
      published,
      files: [...release.files].map(([path, bytes]) => ({ path, bytes: bytes.byteLength })),
      restoresData:
        target.installId === null && reusableUninstall(await listUninstalled(), target.normalizedUrl, admission.manifest.dataVersion) !== null,
    },
  };
}

/** Drop a staged release the admin decided against. */
export async function discardStaged(stagingId: string) {
  if (STAGING_ID.test(stagingId)) await rm(stagingDir(stagingId), { recursive: true, force: true });
}

/** Put a staged bundle at its install's <sha> directory. A bundle already there has the same content. */
async function moveIntoPlace(stagingId: string, installId: string, sha: string): Promise<string> {
  const target = join(extensionsRoot(), installId, sha);
  if (!(await exists(target))) {
    await mkdir(dirname(target), { recursive: true });
    await rename(join(stagingDir(stagingId), 'bundle'), target);
  }
  await rm(stagingDir(stagingId), { recursive: true, force: true });
  return target;
}

const releaseRecord = (release: Pick<StagedRelease, 'tag' | 'sha' | 'manifest'>): ReleaseRecord => ({
  tag: release.tag,
  sha: release.sha,
  version: release.manifest.version,
  dataVersion: release.manifest.dataVersion,
  installedAt: new Date().toISOString(),
});

// --- install --------------------------------------------------------------------

/** Fetch and admit a release for a new install. `tag` is ignored for a local file:// project. */
export async function stageInstall(gitUrl: string, tag: string | null, options: StageOptions = {}): Promise<StageResult> {
  const url = gitUrl.trim();
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeGitUrl(url);
  } catch {
    return refused('gitUrl', `${JSON.stringify(url)} is not a repository URL`);
  }
  const existing = (await listInstalls()).find((install) => install.normalizedUrl === normalizedUrl);
  if (existing) return alreadyInstalled(existing);
  const isLocal = url.toLowerCase().startsWith('file:');
  return stage({ installId: null, gitUrl: url, normalizedUrl, tag: isLocal ? null : tag }, options);
}

/**
 * Claim the staged release's collections, move its bundle into place, and
 * record the install. A repository uninstalled inside the grace period gets
 * its earlier install id back, and with it that install's k/v store and
 * pending timers, when the release is at the data version the earlier one
 * left. Otherwise it gets a new id, and the earlier install's data waits out
 * the grace period.
 */
export async function confirmInstall(stagingId: string): Promise<InstallResult> {
  const staged = await readStaged(stagingId);
  if (!staged || staged.installId) return stagingGone();
  return withStore(async (store) => {
    if (!(await exists(stagingDir(stagingId)))) return stagingGone();
    const existing = store.installs.find((install) => install.normalizedUrl === staged.normalizedUrl);
    if (existing) {
      await discardStaged(stagingId);
      return alreadyInstalled(existing);
    }
    const claim = await claimCollections(staged.normalizedUrl, staged.manifest.collections);
    if (!claim.ok) {
      return {
        ok: false,
        errors: claim.conflicts.map(({ collection, heldBy }) => ({ field: 'collections', message: `${collection} belongs to ${heldBy}, which declared it first` })),
      };
    }
    const earlier = reusableUninstall(store.uninstalled ?? [], staged.normalizedUrl, staged.manifest.dataVersion);
    const id = earlier?.installId ?? newInstallId();
    await moveIntoPlace(stagingId, id, staged.sha);
    // No longer uninstalled, so the grace-period purge leaves its data alone.
    if (earlier) store.uninstalled = store.uninstalled!.filter((entry) => entry !== earlier);
    const now = new Date().toISOString();
    const install: ExtensionInstall = {
      id,
      gitUrl: staged.gitUrl,
      normalizedUrl: staged.normalizedUrl,
      source: staged.source,
      tag: staged.tag,
      sha: staged.sha,
      state: 'active',
      manifest: staged.manifest,
      history: [releaseRecord(staged)],
      installedAt: now,
      updatedAt: now,
    };
    store.installs.push(install);
    return { ok: true, install };
  });
}

// --- updates ----------------------------------------------------------------------

type Version = { core: [number, number, number]; pre: string[] };

function parseVersionTag(name: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(name);
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] };
}

/** Semantic version order: a prerelease sorts before its release. */
function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const [x, y] = [a.pre[i], b.pre[i]];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const [xn, yn] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Version tags newer than the installed one, newest first, and every tag this
 * install has run that now points at a different commit. Tags that aren't
 * versions (and installs of a tag that isn't one) have no order, so they're
 * never listed as newer.
 */
export async function listUpdates(installId: string): Promise<UpdateListing> {
  const install = await getInstall(installId);
  if (!install) return refused('installId', 'No such install');
  if (install.source === 'dev') return { ok: true, newer: [], changed: [] };

  let tags: RemoteTag[];
  try {
    tags = await listRemoteTags(install.gitUrl);
  } catch (error) {
    if (error instanceof ReleaseError) return refused('release', error.message);
    throw error;
  }

  const installed = install.tag ? parseVersionTag(install.tag) : null;
  const newer = installed
    ? tags
        .map((tag) => ({ tag, version: parseVersionTag(tag.name) }))
        .filter((entry): entry is { tag: RemoteTag; version: Version } => entry.version !== null && compareVersions(entry.version, installed) > 0)
        .sort((a, b) => compareVersions(b.version, a.version))
        .map((entry) => entry.tag)
    : [];

  const lastSha = new Map<string, string>();
  for (const record of install.history) if (record.tag) lastSha.set(record.tag, record.sha);
  const changed = tags.flatMap((tag) => {
    const recorded = lastSha.get(tag.name);
    return recorded && recorded !== tag.sha ? [{ tag: tag.name, installedSha: recorded, currentSha: tag.sha }] : [];
  });
  return { ok: true, newer, changed };
}

/**
 * The newest version tag that isn't a prerelease, for an install that doesn't
 * name a tag, or null when the repository has none. Throws a ReleaseError when
 * the repository can't be read.
 */
export async function latestReleaseTag(gitUrl: string): Promise<string | null> {
  const releases = (await listRemoteTags(gitUrl))
    .map((tag) => ({ name: tag.name, version: parseVersionTag(tag.name) }))
    .filter((entry): entry is { name: string; version: Version } => entry.version !== null && !entry.version.pre.length)
    .sort((a, b) => compareVersions(b.version, a.version));
  return releases[0]?.name ?? null;
}

/** Fetch and admit a release to update an install to. A local project is re-read; `tag` is ignored for it. */
export async function stageUpdate(installId: string, tag: string | null, options: StageOptions = {}): Promise<StageResult> {
  const install = await getInstall(installId);
  if (!install) return refused('installId', 'No such install');
  return stage(
    {
      installId,
      gitUrl: install.gitUrl,
      normalizedUrl: install.normalizedUrl,
      tag: install.source === 'dev' ? null : tag,
      activeSha: install.sha,
    },
    options,
  );
}

/** Move an install to a staged release, running `migrate` first. */
export async function applyUpdate(installId: string, stagingId: string, options: UpdateOptions = {}): Promise<InstallResult> {
  const staged = await readStaged(stagingId);
  if (!staged || staged.installId !== installId) return stagingGone();
  return withStore(async (store) => {
    const install = store.installs.find((entry) => entry.id === installId);
    if (!install) return refused('installId', 'No such install');
    if (!(await exists(stagingDir(stagingId)))) return stagingGone();
    if (staged.sha === install.sha) {
      await discardStaged(stagingId);
      return refused('release', `Release ${shortSha(staged.sha)} is already active`);
    }
    const claim = await claimCollections(install.normalizedUrl, staged.manifest.collections);
    if (!claim.ok) {
      return {
        ok: false,
        errors: claim.conflicts.map(({ collection, heldBy }) => ({ field: 'collections', message: `${collection} belongs to ${heldBy}, which declared it first` })),
      };
    }

    const hadBundle = await exists(join(extensionsRoot(), installId, staged.sha));
    const dir = await moveIntoPlace(stagingId, installId, staged.sha);
    const timeoutMs = options.migrateTimeoutMs ?? MIGRATE_TIMEOUT_MS;
    const abandoned = new AbortController();
    try {
      // Every later mutation waits on this one, so a migration that never
      // settles is refused at the deadline. It may still be queued or running
      // then; the aborted signal tells it to stop.
      await beforeDeadline(
        options.migrate?.({
          install: structuredClone(install),
          from: { tag: install.tag, sha: install.sha, manifest: install.manifest, dir: bundleDir(install) },
          to: { tag: staged.tag, sha: staged.sha, manifest: staged.manifest, dir },
          signal: abandoned.signal,
        }),
        timeoutMs,
        () => new Error(`The migration took longer than ${timeoutMs / 1000} seconds`),
      );
    } catch (error) {
      abandoned.abort();
      if (!hadBundle) await rm(dir, { recursive: true, force: true });
      const current = install.tag ?? shortSha(install.sha);
      return refused('migrate', `The update's migration failed, so ${current} stays active: ${messageOf(error)}`);
    }

    install.tag = staged.tag;
    install.sha = staged.sha;
    install.manifest = staged.manifest;
    install.history.push(releaseRecord(staged));
    install.updatedAt = new Date().toISOString();
    return { ok: true, install };
  });
}

/** Switch an install back to a release it ran before, when that release reads the same data version. */
export function rollbackInstall(installId: string, sha: string): Promise<InstallResult> {
  return withStore(async (store) => {
    const install = store.installs.find((entry) => entry.id === installId);
    if (!install) return refused('installId', 'No such install');
    const record = install.history.findLast((entry) => entry.sha === sha);
    if (!record) return refused('sha', `${shortSha(sha)} isn't a release this install has run`);
    if (sha === install.sha) return refused('sha', `${shortSha(sha)} is already active`);
    if (record.dataVersion !== install.manifest.dataVersion) {
      return refused(
        'sha',
        `${record.tag ?? shortSha(sha)} uses data version ${record.dataVersion}, but stored data is at data version ${install.manifest.dataVersion}, so it can't be rolled back to`,
      );
    }
    let manifest: ExtensionManifest;
    try {
      manifest = JSON.parse(await readFile(join(bundleDir({ id: installId, sha }), 'manifest.json'), 'utf8'));
    } catch {
      return refused('sha', `The bundle for ${record.tag ?? shortSha(sha)} is no longer on disk`);
    }
    // A collection this release declared may have been released and claimed by
    // another repository since the install moved off it.
    const claim = await claimCollections(install.normalizedUrl, manifest.collections);
    if (!claim.ok) {
      return {
        ok: false,
        errors: claim.conflicts.map(({ collection, heldBy }) => ({ field: 'collections', message: `${collection} belongs to ${heldBy}, which declared it first` })),
      };
    }
    install.tag = record.tag;
    install.sha = sha;
    install.manifest = manifest;
    install.updatedAt = new Date().toISOString();
    return { ok: true, install };
  });
}

// --- disable, enable, uninstall -------------------------------------------------

async function openWorkRefusal(install: ExtensionInstall, options: StopOptions): Promise<Refused | null> {
  if (options.force || !options.hasOpenWork) return null;
  if (!(await options.hasOpenWork(install))) return null;
  return refused('openWork', `${install.manifest.name} reports work in progress. Force it to go ahead anyway.`);
}

function setState(installId: string, state: InstallState, options: StopOptions): Promise<InstallResult> {
  return withStore(async (store) => {
    const install = store.installs.find((entry) => entry.id === installId);
    if (!install) return refused('installId', 'No such install');
    if (state === 'disabled') {
      const blocked = await openWorkRefusal(install, options);
      if (blocked) return blocked;
    }
    install.state = state;
    install.updatedAt = new Date().toISOString();
    return { ok: true, install };
  });
}

export const disableInstall = (installId: string, options: StopOptions = {}) => setState(installId, 'disabled', options);

export const enableInstall = (installId: string) => setState(installId, 'active', {});

/**
 * Remove an install and its bundles. Its collection claims stay, because the
 * records it published stay in the forum's repo. Its private data (k/v, timers)
 * stays until the uninstall grace period ends and a purge removes it, unless a
 * reinstall of the same repository picks it back up first.
 */
export function uninstall(installId: string, options: StopOptions = {}): Promise<{ ok: true } | Refused> {
  return withStore(async (store) => {
    const index = store.installs.findIndex((entry) => entry.id === installId);
    if (index === -1) return refused('installId', 'No such install');
    const blocked = await openWorkRefusal(store.installs[index], options);
    if (blocked) return blocked;
    const [removed] = store.installs.splice(index, 1);
    const shas = new Set([removed.sha, ...removed.history.map((release) => release.sha)]);
    for (const sha of shas) await rm(join(extensionsRoot(), installId, sha), { recursive: true, force: true });
    store.uninstalled = [
      ...(store.uninstalled ?? []),
      { installId, uninstalledAt: new Date().toISOString(), normalizedUrl: removed.normalizedUrl, dataVersion: removed.manifest.dataVersion },
    ];
    return { ok: true };
  });
}
