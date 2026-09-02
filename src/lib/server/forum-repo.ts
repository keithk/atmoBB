import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import { agentFor } from './atproto-oauth';
import { FORUM_DID } from './appview';
import { parseAtUri } from '$lib/appview-paths';

const NS = 'app.atmobb';
const DEV_FORUM_DID = 'did:plc:atmobbdevforum';

export type ForumWriteMode = 'pds' | 'index';

export function forumWriteMode(): ForumWriteMode {
  const mode = env.ATMOBB_FORUM_WRITE_MODE;
  if (mode === 'pds' || mode === 'index') return mode;
  return FORUM_DID() === DEV_FORUM_DID ? 'index' : 'pds';
}

export interface ForumRecordValue {
  [k: string]: unknown;
}

export async function createForumRecord(
  collection: string,
  value: ForumRecordValue,
): Promise<{ uri: string }> {
  const record = { $type: collection, createdAt: new Date().toISOString(), ...value };
  if (forumWriteMode() === 'index') return indexPut(collection, tid(), record);
  const agent = await agentFor(FORUM_DID());
  const res = await agent.com.atproto.repo.createRecord({
    repo: FORUM_DID(),
    collection,
    record,
  });
  return { uri: res.data.uri };
}

export async function putForumRecord(
  collection: string,
  rkey: string,
  value: ForumRecordValue,
): Promise<{ uri: string }> {
  const record = { $type: collection, ...value };
  if (forumWriteMode() === 'index') return indexPut(collection, rkey, record);
  const agent = await agentFor(FORUM_DID());
  const res = await agent.com.atproto.repo.putRecord({
    repo: FORUM_DID(),
    collection,
    rkey,
    record,
  });
  return { uri: res.data.uri };
}

/** Upload a blob owned by the forum account for use in one of its records. */
export async function uploadForumBlob(bytes: Uint8Array, encoding: string) {
  if (forumWriteMode() === 'index') {
    throw new Error('font uploads require a real forum account and PDS');
  }
  const agent = await agentFor(FORUM_DID());
  const uploaded = await agent.com.atproto.repo.uploadBlob(bytes, { encoding });
  return uploaded.data.blob;
}

export async function deleteForumRecord(uri: string): Promise<void> {
  const p = parseAtUri(uri);
  if (!p || p.did !== FORUM_DID()) throw new Error('not a record in this forum repo');
  if (forumWriteMode() === 'index') {
    const db = pg();
    await db`DELETE FROM happyview_record_refs WHERE source_uri = ${uri}`;
    await db`DELETE FROM happyview_records WHERE uri = ${uri}`;
    return;
  }
  const agent = await agentFor(FORUM_DID());
  await agent.com.atproto.repo.deleteRecord({
    repo: FORUM_DID(),
    collection: p.collection,
    rkey: p.rkey,
  });
}

// --- dev index backend (mirrors appview/seed-dev.ts) ------------------------

let db: ReturnType<typeof postgres> | null = null;
function pg() {
  db ??= postgres(
    env.HAPPYVIEW_PG_URL ?? 'postgres://happyview:happyview@127.0.0.1:5433/happyview',
  );
  return db;
}

const B32 = '234567abcdefghijklmnopqrstuvwxyz';
let lastTid = 0n;
function tid(): string {
  let v = ((BigInt(Date.now()) * 1000n) << 10n) | BigInt(Math.floor(Math.random() * 1024));
  if (v <= lastTid) v = lastTid + 1n;
  lastTid = v;
  let s = '';
  for (let i = 12; i >= 0; i--) s += B32[Number((v >> BigInt(i * 5)) & 31n)];
  return s;
}

async function indexPut(
  collection: string,
  rkey: string,
  record: ForumRecordValue,
): Promise<{ uri: string }> {
  const did = FORUM_DID();
  const uri = `at://${did}/${collection}/${rkey}`;
  const json = JSON.stringify(record);
  const now = new Date().toISOString();
  const refs = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string' && v.startsWith('at://')) refs.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(record);
  const sql = pg();
  await sql`
    INSERT INTO happyview_records (uri, did, collection, rkey, record, cid, indexed_at, created_at)
    VALUES (${uri}, ${did}, ${collection}, ${rkey}, ${json}, ${'bafydev' + rkey}, ${now}, ${now})
    ON CONFLICT (uri) DO UPDATE SET record = EXCLUDED.record, indexed_at = EXCLUDED.indexed_at`;
  // Mimic the onModerationAction trigger (jetstream never sees index writes):
  // origin hide/lock/pin flip the stats flags when the signer owns the board.
  const action = record as {
    action?: string;
    subject?: { uri?: string; did?: string };
    board?: string;
    reason?: string;
    expiresAt?: string;
    createdAt?: string;
  };
  if (collection === `${NS}.moderation.action` && action.subject?.did) {
    if (action.action === 'ban') {
      await sql`
        INSERT INTO atmobb_bans (uri, forum_did, did, board_uri, since, until, reason)
        VALUES (${uri}, ${did}, ${action.subject.did}, ${action.board ?? null}, ${action.createdAt ?? now}, ${action.expiresAt ?? null}, ${action.reason ?? null})
        ON CONFLICT (uri) DO NOTHING`;
    } else if (action.action === 'unban') {
      await sql`
        DELETE FROM atmobb_bans WHERE forum_did = ${did} AND did = ${action.subject.did}
          AND COALESCE(board_uri, '') = ${action.board ?? ''}`;
    }
  }
  if (collection === `${NS}.moderation.action` && action.subject?.uri) {
    const thread = action.subject.uri;
    const owned = sql`thread_uri = ${thread} AND split_part(board_uri, '/', 3) = ${did}`;
    switch (action.action) {
      case 'hide':
      case 'unhide':
        await sql`UPDATE atmobb_thread_stats SET hidden = ${action.action === 'hide'} WHERE ${owned}`;
        break;
      case 'lock':
        await sql`UPDATE atmobb_thread_stats SET locked = true, locked_at = ${action.createdAt ?? now} WHERE ${owned}`;
        break;
      case 'unlock':
        await sql`UPDATE atmobb_thread_stats SET locked = false, locked_at = NULL WHERE ${owned}`;
        break;
      case 'pin':
      case 'unpin':
        await sql`UPDATE atmobb_thread_stats SET pinned = ${action.action === 'pin'} WHERE ${owned}`;
        break;
    }
  }
  await sql`DELETE FROM happyview_record_refs WHERE source_uri = ${uri}`;
  for (const target of refs) {
    await sql`
      INSERT INTO happyview_record_refs (source_uri, target_uri, collection)
      VALUES (${uri}, ${target}, ${collection})
      ON CONFLICT DO NOTHING`;
  }
  return { uri };
}
