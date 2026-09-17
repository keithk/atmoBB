import { Lexicons, type LexiconDoc } from '@atproto/lexicon';
import { isValidDid, isValidNsid, isValidRecordKey } from '@atproto/syntax';
import {
  isObject,
  type RecordCreate,
  type RecordDelete,
  type RecordGet,
  type RecordList,
  type RecordListResult,
  type RecordPut,
  type RecordRef,
  type StoredRecord,
} from '$lib/extensions/contract';
import { parseAtUri } from '$lib/appview-paths';
import { FORUM_DID } from '../appview';
import {
  FORUM_RECONNECT_MESSAGE,
  createForumRecordAsGiven,
  deleteForumRecord,
  getForumRecord,
  isForumScopeError,
  listForumRecords,
  putForumRecord,
} from '../forum-repo';
import { reservedReason } from './manifest';
import { OutboundFetchError, outboundFetch, pdsServiceEndpoint, resolveDidDocument } from './outbound';

// Extension records live only in the forum's repo, written as the forum
// account, so nobody can forge one from their own repo and members never see a
// consent prompt. The forum session already holds every sysop scope, which
// makes the install's approved collections (re-checked against the deny list
// on every call) the only thing standing between an extension and a staff
// grant. Reads may name any repo, and read the forum's own when they name
// none, but a returned record only counts when its at-uri sits in the repo and
// collection that were asked for.
//
// Errors carry lexicon validation paths and status codes, never a PDS's
// response text.

/** Pages of 100 read from another repo's PDS before a listing stops. */
export const MAX_READ_PAGES = 10;
const READ_PAGE_LIMIT = 100;
const READ_MAX_BYTES = 2 * 1024 * 1024;
const READ_TIMEOUT_MS = 5_000;

/** What the caller knows about the install making the call. */
export interface RecordInstall {
  /** The collections the admin approved for this install. */
  collections: ReadonlySet<string>;
  /** The lexicon documents the install shipped. */
  lexicons: LexiconDoc[];
}

export type { RecordGet, RecordList, RecordListResult, StoredRecord };

export type RecordErrorCode =
  | 'CollectionNotApproved'
  | 'CollectionReserved'
  | 'InvalidRecord'
  | 'InvalidRecordKey'
  | 'InvalidRepo'
  | 'ForumNeedsReconnect'
  | 'WriteFailed'
  | 'ReadFailed';

export class RecordError extends Error {
  constructor(
    public readonly code: RecordErrorCode,
    message: string,
    /** The HTTP status a PDS answered with, when one did. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'RecordError';
  }
}

function checkCollection(install: RecordInstall, collection: unknown): asserts collection is string {
  if (typeof collection !== 'string' || !install.collections.has(collection)) {
    throw new RecordError('CollectionNotApproved', `${String(collection)} is not a collection this extension was approved for`);
  }
  const reserved = reservedReason(collection);
  if (reserved) throw new RecordError('CollectionReserved', reserved);
  if (!isValidNsid(collection)) throw new RecordError('CollectionNotApproved', `${collection} is not a valid NSID`);
}

function checkRecordKey(rkey: unknown): asserts rkey is string {
  if (!isValidRecordKey(rkey)) throw new RecordError('InvalidRecordKey', `${JSON.stringify(rkey)} is not a valid record key`);
}

/** The record as it will be written: the guest's fields, with `$type` always the collection. */
function finalRecord(install: RecordInstall, collection: string, record: unknown): Record<string, unknown> {
  if (!isObject(record)) throw new RecordError('InvalidRecord', 'Record must be an object');
  const final = { ...record, $type: collection };
  try {
    new Lexicons(install.lexicons).assertValidRecord(collection, final);
  } catch (error) {
    throw new RecordError('InvalidRecord', error instanceof Error ? error.message : String(error));
  }
  return final;
}

const statusOf = (error: unknown) => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 100 ? status : undefined;
};

function writeFailure(error: unknown): RecordError {
  if (isForumScopeError(error)) return new RecordError('ForumNeedsReconnect', FORUM_RECONNECT_MESSAGE);
  const status = statusOf(error);
  return status
    ? new RecordError('WriteFailed', `The forum's PDS refused the write with status ${status}`, status)
    : new RecordError('WriteFailed', "The forum couldn't write the record");
}

async function write<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw writeFailure(error);
  }
}

/** Create a record in the forum's repo, at `rkey` when the extension chose one. */
export async function createRecord(install: RecordInstall, payload: RecordCreate): Promise<RecordRef> {
  checkCollection(install, payload.collection);
  if (payload.rkey !== undefined) checkRecordKey(payload.rkey);
  const record = finalRecord(install, payload.collection, payload.record);
  return write(() => createForumRecordAsGiven(payload.collection, record, payload.rkey));
}

/** Write a record at `rkey` in the forum's repo, replacing whatever was there. */
export async function putRecord(install: RecordInstall, payload: RecordPut): Promise<RecordRef> {
  checkCollection(install, payload.collection);
  checkRecordKey(payload.rkey);
  const record = finalRecord(install, payload.collection, payload.record);
  return write(() => putForumRecord(payload.collection, payload.rkey, record));
}

export async function deleteRecord(install: RecordInstall, payload: RecordDelete): Promise<void> {
  checkCollection(install, payload.collection);
  checkRecordKey(payload.rkey);
  await write(() => deleteForumRecord(`at://${FORUM_DID()}/${payload.collection}/${payload.rkey}`));
}

// --- reads -------------------------------------------------------------------

function checkRepo(repo: unknown): asserts repo is string {
  if (!isValidDid(repo)) throw new RecordError('InvalidRepo', `${JSON.stringify(repo)} is not a valid DID`);
}

/** The record, when it is well-formed and its at-uri sits in the requested repo and collection. */
function counted(raw: unknown, repo: string, collection: string, rkey?: string): StoredRecord | null {
  if (!isObject(raw) || typeof raw.uri !== 'string' || typeof raw.cid !== 'string' || !isObject(raw.value)) return null;
  const at = parseAtUri(raw.uri);
  if (!at || at.did !== repo || at.collection !== collection || (rkey !== undefined && at.rkey !== rkey)) return null;
  return { uri: raw.uri, cid: raw.cid, value: raw.value };
}

function forumReadFailure(error: unknown): RecordError {
  const status = statusOf(error);
  return new RecordError('ReadFailed', status ? `The forum's PDS answered the read with status ${status}` : "The forum's records couldn't be read", status);
}

async function pdsEndpoint(repo: string): Promise<string> {
  let doc;
  try {
    doc = await resolveDidDocument(repo);
  } catch (error) {
    const code = error instanceof OutboundFetchError ? `: ${error.code}` : '';
    throw new RecordError('ReadFailed', `Couldn't resolve ${repo}${code}`);
  }
  if (doc.id !== repo) throw new RecordError('ReadFailed', `${repo}'s DID document names a different DID`);
  const endpoint = pdsServiceEndpoint(doc, repo);
  if (!endpoint) throw new RecordError('ReadFailed', `${repo} lists no PDS`);
  return endpoint.replace(/\/+$/, '');
}

/** One XRPC query against another repo's PDS, through the hardened fetcher. */
async function pdsQuery(repo: string, pds: string, method: string, params: Record<string, string>) {
  let res;
  try {
    res = await outboundFetch(`${pds}/xrpc/${method}?${new URLSearchParams(params)}`, {
      headers: { accept: 'application/json' },
      maxBytes: READ_MAX_BYTES,
      timeoutMs: READ_TIMEOUT_MS,
    });
  } catch (error) {
    const code = error instanceof OutboundFetchError ? `: ${error.code}` : '';
    throw new RecordError('ReadFailed', `Couldn't reach ${repo}'s PDS${code}`);
  }
  let body: unknown = null;
  try {
    body = JSON.parse(new TextDecoder().decode(res.body));
  } catch {
    // An unreadable body is handled below the same as a missing one.
  }
  return { status: res.status, body };
}

const pdsFailure = (repo: string, status: number) =>
  new RecordError('ReadFailed', `${repo}'s PDS answered with status ${status}`, status);

/** Records in one approved collection of any repo; the forum's own repo is read the way admin lists read it. */
export async function listRecords(install: RecordInstall, query: RecordList): Promise<RecordListResult> {
  checkCollection(install, query.collection);
  const { repo = FORUM_DID(), collection } = query;
  checkRepo(repo);

  if (repo === FORUM_DID()) {
    let records: unknown[];
    try {
      records = await listForumRecords(collection);
    } catch (error) {
      throw forumReadFailure(error);
    }
    return { records: records.flatMap((raw) => counted(raw, repo, collection) ?? []), truncated: false };
  }

  const pds = await pdsEndpoint(repo);
  const records: StoredRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_READ_PAGES; page++) {
    const params: Record<string, string> = { repo, collection, limit: String(READ_PAGE_LIMIT) };
    if (cursor) params.cursor = cursor;
    const { status, body } = await pdsQuery(repo, pds, 'com.atproto.repo.listRecords', params);
    if (status !== 200 || !isObject(body) || !Array.isArray(body.records)) throw pdsFailure(repo, status);
    records.push(...body.records.flatMap((raw) => counted(raw, repo, collection) ?? []));
    cursor = typeof body.cursor === 'string' && body.cursor ? body.cursor : undefined;
    if (!cursor) return { records, truncated: false };
  }
  return { records, truncated: true };
}

/** One record from an approved collection of any repo, or null when it isn't there or doesn't count. */
export async function getRecord(install: RecordInstall, query: RecordGet): Promise<StoredRecord | null> {
  checkCollection(install, query.collection);
  const { repo = FORUM_DID(), collection, rkey } = query;
  checkRepo(repo);
  checkRecordKey(rkey);

  if (repo === FORUM_DID()) {
    let record;
    try {
      record = await getForumRecord(collection, rkey);
    } catch (error) {
      throw forumReadFailure(error);
    }
    return counted(record, repo, collection, rkey);
  }

  const pds = await pdsEndpoint(repo);
  const { status, body } = await pdsQuery(repo, pds, 'com.atproto.repo.getRecord', { repo, collection, rkey });
  if (status === 400 && isObject(body) && body.error === 'RecordNotFound') return null;
  if (status !== 200) throw pdsFailure(repo, status);
  return counted(body, repo, collection, rkey);
}
