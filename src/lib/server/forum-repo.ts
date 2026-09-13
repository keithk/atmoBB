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

/** Turn a stale forum-account OAuth grant into an actionable admin message. */
export function forumWriteErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (/scope|permission|not authorized/i.test(message)) {
    return 'The forum account needs updated permissions. Reconnect it in Admin → Connection, then try again.';
  }
  return message || fallback;
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

/** Create many records in one collection: applyWrites in chunks of 200 (the
 *  PDS ceiling per call), or one index write each in dev. */
export async function createForumRecords(
  collection: string,
  values: ForumRecordValue[],
): Promise<void> {
  const createdAt = new Date().toISOString();
  const records = values.map((value) => ({ $type: collection, createdAt, ...value }));
  if (forumWriteMode() === 'index') {
    for (const record of records) await indexPut(collection, tid(), record);
    return;
  }
  const agent = await agentFor(FORUM_DID());
  for (let i = 0; i < records.length; i += 200) {
    await agent.com.atproto.repo.applyWrites({
      repo: FORUM_DID(),
      writes: records.slice(i, i + 200).map((value) => ({
        $type: 'com.atproto.repo.applyWrites#create' as const,
        collection,
        value,
      })),
    });
  }
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
  // origin hide/lock/pin flip the stats flags when the signer owns the board;
  // account actions maintain bans, membership windows, and gating periods.
  const action = record as {
    action?: string;
    subject?: { uri?: string; did?: string };
    board?: string;
    reason?: string;
    expiresAt?: string;
    createdAt?: string;
    sponsor?: string;
    via?: string;
    mode?: string;
  };
  if (collection === `${NS}.moderation.action` && action.subject?.did) {
    const member = action.subject.did;
    const at = action.createdAt ?? now;
    if (action.action === 'ban') {
      await sql`
        INSERT INTO atmobb_bans (uri, forum_did, did, board_uri, since, until, reason)
        VALUES (${uri}, ${did}, ${member}, ${action.board ?? null}, ${at}, ${action.expiresAt ?? null}, ${action.reason ?? null})
        ON CONFLICT (uri) DO NOTHING`;
    } else if (action.action === 'unban') {
      await sql`
        DELETE FROM atmobb_bans WHERE forum_did = ${did} AND did = ${member}
          AND COALESCE(board_uri, '') = ${action.board ?? ''}`;
    }
    // Windows and gating periods apply in (createdAt, uri) order relative to
    // the rows already there, matching the Lua trigger and rebuild-stats.sql.
    if (action.action === 'acceptMember') {
      await sql`
        INSERT INTO atmobb_member_windows (action_uri, forum_did, did, since, until, sponsor, via)
        SELECT ${uri}::text, ${did}::text, ${member}::text, ${at}::text,
          (SELECT COALESCE((r.record::jsonb)->>'createdAt', r.created_at)
             FROM happyview_records r
            WHERE r.collection = ${`${NS}.moderation.action`}
              AND r.did = ${did}
              AND (r.record::jsonb)->'subject'->>'did' = ${member}
              AND ((r.record::jsonb)->>'action' = 'revokeMember'
                OR ((r.record::jsonb)->>'action' = 'ban' AND (r.record::jsonb)->>'board' IS NULL))
              AND (COALESCE((r.record::jsonb)->>'createdAt', r.created_at), r.uri) > (${at}::text, ${uri}::text)
            ORDER BY COALESCE((r.record::jsonb)->>'createdAt', r.created_at), r.uri
            LIMIT 1),
          ${action.sponsor ?? null}::text, ${action.via ?? null}::text
        WHERE NOT EXISTS (
          SELECT 1 FROM atmobb_member_windows w
          WHERE w.forum_did = ${did} AND w.did = ${member} AND w.until IS NULL)
        ON CONFLICT (action_uri) DO NOTHING`;
    } else if (action.action === 'revokeMember' || (action.action === 'ban' && !action.board)) {
      await sql`
        UPDATE atmobb_member_windows SET until = ${at}
        WHERE forum_did = ${did} AND did = ${member} AND until IS NULL
          AND (since, action_uri) < (${at}::text, ${uri}::text)`;
    } else if (action.action === 'gateForum' && member === did) {
      await sql`
        INSERT INTO atmobb_forum_gating (action_uri, forum_did, gated_since, opened_at, mode)
        SELECT ${uri}::text, ${did}::text, ${at}::text,
          (SELECT COALESCE((r.record::jsonb)->>'createdAt', r.created_at)
             FROM happyview_records r
            WHERE r.collection = ${`${NS}.moderation.action`}
              AND r.did = ${did}
              AND (r.record::jsonb)->>'action' = 'openForum'
              AND (r.record::jsonb)->'subject'->>'did' = ${did}
              AND (COALESCE((r.record::jsonb)->>'createdAt', r.created_at), r.uri) > (${at}::text, ${uri}::text)
            ORDER BY COALESCE((r.record::jsonb)->>'createdAt', r.created_at), r.uri
            LIMIT 1),
          ${action.mode ?? null}::text
        WHERE NOT EXISTS (
          SELECT 1 FROM atmobb_forum_gating g WHERE g.forum_did = ${did} AND g.opened_at IS NULL)
        ON CONFLICT (action_uri) DO NOTHING`;
    } else if (action.action === 'openForum' && member === did) {
      await sql`
        UPDATE atmobb_forum_gating SET opened_at = ${at}
        WHERE forum_did = ${did} AND opened_at IS NULL
          AND (gated_since, action_uri) < (${at}::text, ${uri}::text)`;
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
