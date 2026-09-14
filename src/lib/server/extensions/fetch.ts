import { createHash } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { env } from '$env/dynamic/private';
import git, { type HttpClient } from 'isomorphic-git';
import { OutboundFetchError, outboundFetch } from './outbound';

// A release is a git tag whose tree holds a built bundle in dist/. The tag is
// fetched with a pure-JS git client into a throwaway gitdir and read straight
// from the object database: nothing is checked out, no build runs, and no git
// binary is needed. Every byte comes through outboundFetch, and the pack is
// vetted object by object before the git client inflates any of it.
//
// A file:// URL names a local extension project instead. It's for authors
// testing against their own forum, so it needs ATMOBB_EXTENSIONS_DEV=1.

/** Bytes of ref advertisement read when listing tags. */
export const MAX_REFS_BYTES = 1024 * 1024;
/** Bytes downloaded for one tag's pack. */
export const MAX_PACK_BYTES = 32 * 1024 * 1024;
export const MAX_PACK_OBJECTS = 10_000;
/** Bytes the whole pack may inflate to. */
export const MAX_UNPACKED_BYTES = 128 * 1024 * 1024;
/** Bytes one object (so one file) may inflate to. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
/** Tree entries walked: the tagged root plus everything under dist/. */
export const MAX_TREE_ENTRIES = 2_000;
/** Bytes of files kept from dist/. */
export const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
/** Wall-clock time for one listing or one release read. */
export const FETCH_TIMEOUT_MS = 60_000;

export interface FetchLimits {
  refsBytes: number;
  packBytes: number;
  packObjects: number;
  unpackedBytes: number;
  fileBytes: number;
  treeEntries: number;
  bundleBytes: number;
  timeoutMs: number;
}

const DEFAULT_LIMITS: FetchLimits = {
  refsBytes: MAX_REFS_BYTES,
  packBytes: MAX_PACK_BYTES,
  packObjects: MAX_PACK_OBJECTS,
  unpackedBytes: MAX_UNPACKED_BYTES,
  fileBytes: MAX_FILE_BYTES,
  treeEntries: MAX_TREE_ENTRIES,
  bundleBytes: MAX_BUNDLE_BYTES,
  timeoutMs: FETCH_TIMEOUT_MS,
};

let limits = DEFAULT_LIMITS;

/** Test-only: lower the caps so fixtures can cross them cheaply. Pass null to restore the defaults. */
export function setFetchLimitsForTests(overrides: Partial<FetchLimits> | null) {
  limits = { ...DEFAULT_LIMITS, ...overrides };
}

/** A refusal whose message reads on its own in the admin UI. */
export class ReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseError';
  }
}

export const devSourcesEnabled = () => env.ATMOBB_EXTENSIONS_DEV === '1';

export type ReleaseSource = 'git' | 'dev';

export interface Release {
  source: ReleaseSource;
  /** Null for a local directory. */
  tag: string | null;
  /** The tagged commit's SHA, or for a local directory, a sha256 over the kept files. */
  sha: string;
  /** manifest.json, parsed but not validated. */
  manifest: unknown;
  /** Kept files keyed by their path relative to dist/. */
  files: Map<string, Uint8Array>;
}

export interface RemoteTag {
  name: string;
  /** The commit the tag points at, peeled through annotated tags. */
  sha: string;
}

/** File types kept from the UI entry's directory. */
const UI_EXTENSIONS = new Set(['.html', '.js', '.css', '.svg', '.png', '.webp', '.woff2', '.json']);
/** Path segments a kept file may use; anything else under dist/ is left behind. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

const megabytes = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

// --- deadline -----------------------------------------------------------------

class Deadline {
  private readonly end = Date.now() + limits.timeoutMs;
  remaining(): number {
    const left = this.end - Date.now();
    if (left <= 0) throw new ReleaseError(`Reading the release took longer than ${limits.timeoutMs / 1000} seconds`);
    return left;
  }
}

// --- git transport over outboundFetch -------------------------------------------

async function collectBody(body: AsyncIterableIterator<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** isomorphic-git's HTTP client, with every request going through outboundFetch. */
function outboundGitHttp(deadline: Deadline, maxBytes: number): HttpClient {
  return {
    async request({ url, method = 'GET', headers = {}, body }) {
      const payload = body ? await collectBody(body) : undefined;
      const requestHeaders = payload ? { ...headers, 'content-length': String(payload.byteLength) } : headers;
      const res = await outboundFetch(url, { method, headers: requestHeaders, body: payload, maxBytes, timeoutMs: deadline.remaining() });
      return {
        url,
        method,
        statusCode: res.status,
        statusMessage: '',
        headers: res.headers,
        body: (async function* () {
          yield res.body;
        })(),
      };
    },
  };
}

function describeGitError(error: unknown, gitUrl: string): Error {
  if (error instanceof ReleaseError) return error;
  if (error instanceof OutboundFetchError) {
    if (error.code === 'ResponseTooLarge') return new ReleaseError(`The release is bigger than the ${megabytes(limits.packBytes)} download limit`);
    if (error.code === 'Timeout') return new ReleaseError(`${gitUrl} took too long to answer`);
    return new ReleaseError(`Couldn't reach ${gitUrl}: ${error.message}`);
  }
  const code = (error as { code?: string }).code;
  if (code === 'UnsafeFilepathError') {
    const path = (error as { data?: { filepath?: string } }).data?.filepath;
    return new ReleaseError(`The release contains an unsafe path (${JSON.stringify(path)}), such as ".." or ".git"`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ReleaseError(`Couldn't read ${gitUrl}: ${message}`);
}

function checkGitUrl(gitUrl: string): URL {
  let url: URL;
  try {
    url = new URL(gitUrl);
  } catch {
    throw new ReleaseError(`${JSON.stringify(gitUrl)} is not a URL`);
  }
  if (url.protocol !== 'https:') throw new ReleaseError('The repository URL must start with https://');
  return url;
}

/** A tag name, not a ref path or anything git would reject. */
function checkTag(tag: string) {
  const valid =
    tag.length > 0 &&
    tag.length <= 200 &&
    /^[A-Za-z0-9._/+-]+$/.test(tag) &&
    !tag.startsWith('-') &&
    !tag.startsWith('refs/') &&
    !tag.split('/').some((segment) => !segment || segment.startsWith('.') || segment.endsWith('.lock')) &&
    !tag.includes('..');
  if (!valid) throw new ReleaseError(`${JSON.stringify(tag)} is not a tag name`);
}

/** Every tag in the repository and the commit it points at. */
export async function listRemoteTags(gitUrl: string): Promise<RemoteTag[]> {
  checkGitUrl(gitUrl);
  const deadline = new Deadline();
  try {
    const refs = await git.listServerRefs({ http: outboundGitHttp(deadline, limits.refsBytes), url: gitUrl, prefix: 'refs/tags/', peelTags: true });
    return refs
      .filter((ref) => ref.ref.startsWith('refs/tags/') && !ref.ref.endsWith('^{}'))
      .map((ref) => ({ name: ref.ref.slice('refs/tags/'.length), sha: ref.peeled ?? ref.oid }));
  } catch (error) {
    throw describeGitError(error, gitUrl);
  }
}

// --- pack vetting ---------------------------------------------------------------

const OBJECT_OFS_DELTA = 6;
const OBJECT_REF_DELTA = 7;

function readVarint(data: Uint8Array, start: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let offset = start;
  for (;;) {
    if (offset >= data.length || shift > 49) throw new ReleaseError('The release pack is malformed');
    const byte = data[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (!(byte & 0x80)) return { value, next: offset };
  }
}

/**
 * Walk a pack's objects and refuse it if any object, or any delta's result,
 * inflates past the file cap, or the whole pack past the unpacked cap. Each
 * object is inflated with its output capped at the size its header declares,
 * so a lying header can't make this allocate more than the caps allow.
 */
function vetPack(pack: Uint8Array, deadline: Deadline) {
  const data = Buffer.from(pack.buffer, pack.byteOffset, pack.byteLength);
  if (data.length < 32 || data.toString('latin1', 0, 4) !== 'PACK') throw new ReleaseError('The repository sent something other than a git pack');
  const count = data.readUInt32BE(8);
  if (count > limits.packObjects) {
    throw new ReleaseError(`The release has ${count} git objects; the limit is ${limits.packObjects}`);
  }
  const tooBig = () => new ReleaseError(`The release has a file bigger than the ${megabytes(limits.fileBytes)} file limit`);

  let offset = 12;
  let unpacked = 0;
  for (let i = 0; i < count; i++) {
    if (i % 256 === 0) deadline.remaining();
    if (offset >= data.length - 20) throw new ReleaseError('The release pack is truncated');
    let byte = data[offset++];
    const type = (byte >> 4) & 7;
    let size = byte & 0x0f;
    let shift = 4;
    while (byte & 0x80) {
      if (offset >= data.length || shift > 49) throw new ReleaseError('The release pack is malformed');
      byte = data[offset++];
      size += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    }
    if (type === OBJECT_OFS_DELTA) offset = readVarint(data, offset).next;
    else if (type === OBJECT_REF_DELTA) offset += 20;
    if (size > limits.fileBytes) throw tooBig();

    let inflated: { buffer: Buffer; engine: { bytesWritten: number } };
    try {
      inflated = inflateSync(data.subarray(offset), { info: true, maxOutputLength: Math.max(size, 1) } as object) as unknown as typeof inflated;
    } catch {
      throw new ReleaseError('The release pack is malformed');
    }
    let objectSize = size;
    if (type === OBJECT_OFS_DELTA || type === OBJECT_REF_DELTA) {
      const base = readVarint(inflated.buffer, 0);
      objectSize = readVarint(inflated.buffer, base.next).value;
      if (objectSize > limits.fileBytes) throw tooBig();
    }
    unpacked += objectSize;
    if (unpacked > limits.unpackedBytes) {
      throw new ReleaseError(`The release unpacks to more than the ${megabytes(limits.unpackedBytes)} limit`);
    }
    offset += inflated.engine.bytesWritten;
  }
}

/** node:fs for isomorphic-git, with every pack vetted before it is written and indexed. */
function vettingFs(deadline: Deadline) {
  return {
    promises: {
      ...fsPromises,
      async writeFile(path: string, contents: Uint8Array | string, options?: object) {
        if (path.endsWith('.pack') && typeof contents !== 'string') vetPack(contents, deadline);
        return fsPromises.writeFile(path, contents, options);
      },
    },
  };
}

// --- bundle selection -------------------------------------------------------------

/** Why a single tree entry name can't be part of a release, or null. */
function unsafeName(name: string): string | null {
  if (!name || name === '.' || name === '..') return `is a "${name}" entry`;
  if (name.includes('/')) return 'contains a slash';
  if (name.includes('\\')) return 'contains a backslash';
  if (name.includes('\0')) return 'contains a NUL byte';
  if (name.toLowerCase() === '.git') return 'is a .git entry';
  return null;
}

function checkName(name: string, path: string) {
  const problem = unsafeName(name);
  if (problem) throw new ReleaseError(`dist/${path} ${problem}`);
}

class EntryCounter {
  private count = 0;
  add() {
    if (++this.count > limits.treeEntries) {
      throw new ReleaseError(`The release has more than ${limits.treeEntries} tree entries`);
    }
  }
}

/**
 * Pick the files a bundle keeps from every path under dist/: manifest.json,
 * extension.wasm, the lexicons the manifest lists, and files of the allowed
 * types under the UI entry's directory.
 */
async function selectBundle(paths: string[], read: (path: string) => Promise<Uint8Array>) {
  const lowered = new Map<string, string>();
  for (const path of paths) {
    const other = lowered.get(path.toLowerCase());
    if (other) throw new ReleaseError(`dist/${other} and dist/${path} collide on case-insensitive file systems`);
    lowered.set(path.toLowerCase(), path);
  }
  const present = new Set(paths);
  if (!present.has('manifest.json')) throw new ReleaseError('The release has no dist/manifest.json');
  if (!present.has('extension.wasm')) {
    throw new ReleaseError('The release has no dist/extension.wasm, the compiled module. Build the extension and commit dist/ before tagging.');
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(await read('manifest.json')));
  } catch (error) {
    throw new ReleaseError(`dist/manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const raw = (typeof manifest === 'object' && manifest !== null ? manifest : {}) as { lexicons?: unknown; ui?: { entry?: unknown } };

  const keep = new Set(['manifest.json', 'extension.wasm']);
  if (Array.isArray(raw.lexicons)) {
    for (const path of raw.lexicons) if (typeof path === 'string' && present.has(path)) keep.add(path);
  }
  const entry = raw.ui?.entry;
  if (typeof entry === 'string') {
    const dir = posix.dirname(entry);
    for (const path of paths) {
      const inside = dir === '.' || path.startsWith(`${dir}/`);
      if (inside && UI_EXTENSIONS.has(posix.extname(path).toLowerCase())) keep.add(path);
    }
  }
  for (const path of keep) if (!path.split('/').every((segment) => SAFE_SEGMENT.test(segment))) keep.delete(path);
  if (typeof entry === 'string' && !keep.has(entry)) {
    throw new ReleaseError(`The manifest's ui.entry, dist/${entry}, is not in the release or is not an allowed file type`);
  }

  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const path of [...keep].sort()) {
    const bytes = await read(path);
    if (bytes.byteLength > limits.fileBytes) {
      throw new ReleaseError(`dist/${path} is bigger than the ${megabytes(limits.fileBytes)} file limit`);
    }
    total += bytes.byteLength;
    if (total > limits.bundleBytes) throw new ReleaseError(`The bundle is bigger than the ${megabytes(limits.bundleBytes)} bundle limit`);
    files.set(path, bytes);
  }
  return { manifest, files };
}

// --- git releases -------------------------------------------------------------------

async function readGitRelease(gitUrl: string, tag: string): Promise<Release> {
  checkGitUrl(gitUrl);
  checkTag(tag);
  const deadline = new Deadline();
  const gitdir = await mkdtemp(join(tmpdir(), 'atmobb-extension-fetch-'));
  const fs = vettingFs(deadline);
  const cache = {};
  try {
    await git.init({ fs, gitdir, bare: true });
    // fetch records what it got under a remote ref, so give it a refspec that maps tags.
    await git.setConfig({ fs, gitdir, path: 'remote.origin.url', value: gitUrl });
    await git.setConfig({ fs, gitdir, path: 'remote.origin.fetch', value: '+refs/tags/*:refs/remotes/origin/tags/*' });
    let fetched: string;
    try {
      const result = await git.fetch({
        fs,
        http: outboundGitHttp(deadline, limits.packBytes),
        gitdir,
        url: gitUrl,
        ref: `refs/tags/${tag}`,
        singleBranch: true,
        tags: false,
        depth: 1,
        cache,
      });
      if (!result.fetchHead) throw new ReleaseError(`The repository has no tag ${tag}`);
      fetched = result.fetchHead;
    } catch (error) {
      if ((error as { code?: string }).code === 'NotFoundError') throw new ReleaseError(`The repository has no tag ${tag}`);
      throw error;
    }

    let oid = fetched;
    for (let hops = 0; ; hops++) {
      const { type } = await git.readObject({ fs, gitdir, oid, format: 'parsed', cache });
      if (type === 'commit') break;
      if (type !== 'tag' || hops > 8) throw new ReleaseError(`Tag ${tag} doesn't point at a commit`);
      oid = (await git.readTag({ fs, gitdir, oid, cache })).tag.object;
    }
    const sha = oid;
    const { commit } = await git.readCommit({ fs, gitdir, oid: sha, cache });

    const counter = new EntryCounter();
    const root = await git.readTree({ fs, gitdir, oid: commit.tree, cache });
    root.tree.forEach(() => counter.add());
    const dist = root.tree.find((entry) => entry.path === 'dist');
    if (!dist) throw new ReleaseError(`Tag ${tag} has no dist/ directory. Build the extension and commit dist/ before tagging.`);
    if (dist.mode === '120000') throw new ReleaseError('dist/ is a symlink');
    if (dist.type !== 'tree') throw new ReleaseError(`Tag ${tag} has no dist/ directory`);

    const blobs = new Map<string, string>();
    const walk = async (treeOid: string, prefix: string) => {
      deadline.remaining();
      const { tree } = await git.readTree({ fs, gitdir, oid: treeOid, cache });
      for (const entry of tree) {
        counter.add();
        const path = prefix ? `${prefix}/${entry.path}` : entry.path;
        checkName(entry.path, path);
        if (entry.mode === '120000') throw new ReleaseError(`dist/${path} is a symlink`);
        if (entry.type === 'commit') throw new ReleaseError(`dist/${path} is a submodule`);
        if (entry.type === 'tree') await walk(entry.oid, path);
        else if (entry.type === 'blob') blobs.set(path, entry.oid);
        else throw new ReleaseError(`dist/${path} is not a file or directory`);
      }
    };
    await walk(dist.oid, '');

    const { manifest, files } = await selectBundle([...blobs.keys()], async (path) => {
      deadline.remaining();
      return (await git.readBlob({ fs, gitdir, oid: blobs.get(path)!, cache })).blob;
    });
    return { source: 'git', tag, sha, manifest, files };
  } catch (error) {
    throw describeGitError(error, gitUrl);
  } finally {
    await rm(gitdir, { recursive: true, force: true });
  }
}

// --- local releases ---------------------------------------------------------------

/** sha256 over each kept file's path, length, and bytes, in path order. */
export function contentHash(files: Map<string, Uint8Array>): string {
  const hash = createHash('sha256');
  for (const path of [...files.keys()].sort()) {
    const bytes = files.get(path)!;
    hash.update(`${path}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

async function readDevRelease(fileUrl: string): Promise<Release> {
  if (!devSourcesEnabled()) {
    throw new ReleaseError('Local file:// extensions are only available when the server runs with ATMOBB_EXTENSIONS_DEV=1');
  }
  let project: string;
  try {
    project = fileURLToPath(fileUrl);
  } catch {
    throw new ReleaseError(`${JSON.stringify(fileUrl)} is not a local directory URL`);
  }
  const distDir = join(project, 'dist');
  const distStat = await lstat(distDir).catch(() => null);
  if (!distStat) throw new ReleaseError(`${project} has no dist/ directory. Build the extension first.`);
  if (distStat.isSymbolicLink()) throw new ReleaseError('dist/ is a symlink');
  if (!distStat.isDirectory()) throw new ReleaseError(`${distDir} is not a directory`);

  const counter = new EntryCounter();
  const found = new Map<string, string>();
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      counter.add();
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      checkName(entry.name, path);
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new ReleaseError(`dist/${path} is a symlink`);
      if (entry.isDirectory()) await walk(full, path);
      else if (entry.isFile()) found.set(path, full);
      else throw new ReleaseError(`dist/${path} is not a file or directory`);
    }
  };
  await walk(distDir, '');

  const { manifest, files } = await selectBundle([...found.keys()], async (path) => {
    const full = found.get(path)!;
    const stat = await lstat(full);
    if (!stat.isFile()) throw new ReleaseError(`dist/${path} changed while it was being read`);
    if (stat.size > limits.fileBytes) throw new ReleaseError(`dist/${path} is bigger than the ${megabytes(limits.fileBytes)} file limit`);
    return readFile(full);
  });
  return { source: 'dev', tag: null, sha: contentHash(files), manifest, files };
}

/** Read a release: a tag from an https:// git repository, or a local file:// project when dev sources are on. */
export function readRelease(url: string, tag: string | null): Promise<Release> {
  if (url.trim().toLowerCase().startsWith('file:')) return readDevRelease(url.trim());
  if (tag === null) return Promise.reject(new ReleaseError('Pick a tag to install'));
  return readGitRelease(url.trim(), tag);
}
