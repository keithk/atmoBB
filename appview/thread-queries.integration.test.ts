import fs from 'node:fs';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

const NS = 'app.atmobb';
const F = 'did:plc:forum';
const BOARD = `at://${F}/${NS}.forum.board/general`;
const PRIVATE = `at://${F}/${NS}.forum.board/private`;
const PEER = `at://did:plc:peer/${NS}.forum.board/general`;
const BLOCKED = `at://did:plc:blocked/${NS}.forum.board/general`;
const DELISTED = `at://did:plc:delisted/${NS}.forum.board/general`;
const OLD = `at://did:plc:author/${NS}.discussion.thread/old`;
const SEARCH = `at://did:plc:author/${NS}.discussion.thread/search`;
const HIDDEN = `at://did:plc:author/${NS}.discussion.thread/hidden`;
const PRIVATE_THREAD = `at://did:plc:author/${NS}.discussion.thread/private`;
const BANNED = `at://did:plc:banned/${NS}.discussion.thread/banned`;

function source(path: string): string {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

function capture(text: string, pattern: RegExp, label: string): string[] {
  const match = text.match(pattern);
  if (!match) throw new Error(`Could not extract ${label} from Lua source`);
  return match.slice(1);
}

function exactQueries() {
  const latest = source('./lua/getLatestThreads.lua');
  const board = source('./lua/getBoardThreads.lua');
  const [latestRows] = capture(latest, /local rows = db\.raw\(\[\[([\s\S]*?)\]\], \{/, 'latest rows');
  const [peers] = capture(board, /local peers_cte = \[\[([\s\S]*?)\]\]/, 'board peers CTE');
  const [window] = capture(board, /local window = \[\[([\s\S]*?)\]\]/, 'board visibility window');
  const [filteredBefore, filteredAfter] = capture(
    board,
    /local filtered = db\.raw\(peers_cte \.\. \[\[([\s\S]*?)\]\] \.\. window \.\. \[\[([\s\S]*?)\]\],/,
    'board filtered count',
  );
  const [rowsBefore, rowsAfter] = capture(
    board,
    /local rows = db\.raw\(peers_cte \.\. \[\[([\s\S]*?)\]\] \.\. window \.\. \[\[([\s\S]*?)\]\],/,
    'board rows',
  );
  return {
    latestRows,
    boardFiltered: peers + filteredBefore + window + filteredAfter,
    boardRows: peers + rowsBefore + window + rowsAfter,
  };
}

const profile = (name: string) => JSON.stringify({ displayName: name });
const boardRecord = (name: string, extra = {}) => JSON.stringify({ name, topic: 'shared', ...extra });
const threadRecord = (board: string, title: string, tags: string[] = []) => JSON.stringify({ board, title, tags });

async function fixtures(sql: Sql) {
  await sql.unsafe(`
    CREATE TEMP TABLE happyview_records (
      uri text PRIMARY KEY, did text NOT NULL, collection text NOT NULL, rkey text NOT NULL,
      record text NOT NULL, cid text, created_at text NOT NULL
    );
    CREATE TEMP TABLE happyview_record_refs (source_uri text, target_uri text);
    CREATE TEMP TABLE atmobb_thread_stats (
      thread_uri text PRIMARY KEY, board_uri text, author_did text, title text, created_at text,
      reply_count integer, last_activity text, last_reply_did text, hidden boolean,
      locked boolean DEFAULT false, locked_at text, pinned boolean DEFAULT false
    );
    CREATE TEMP TABLE atmobb_delisted_forums (did text PRIMARY KEY);
    CREATE TEMP TABLE atmobb_bans (
      uri text PRIMARY KEY, forum_did text, did text, board_uri text, since text, until text
    );
  `);

  const records: [string, string, string, string, string, string, string][] = [
    [BOARD, F, `${NS}.forum.board`, 'general', boardRecord('General'), 'b1', '2020-01-01T00:00:00Z'],
    [PRIVATE, F, `${NS}.forum.board`, 'private', boardRecord('Private', { access: { space: 'at://space' } }), 'b2', '2020-01-01T00:00:00Z'],
    [PEER, 'did:plc:peer', `${NS}.forum.board`, 'general', boardRecord('Peer'), 'b3', '2020-01-01T00:00:00Z'],
    [BLOCKED, 'did:plc:blocked', `${NS}.forum.board`, 'general', boardRecord('Blocked'), 'b4', '2020-01-01T00:00:00Z'],
    [DELISTED, 'did:plc:delisted', `${NS}.forum.board`, 'general', boardRecord('Delisted'), 'b5', '2020-01-01T00:00:00Z'],
  ];
  for (const [did, name] of [['did:plc:author', 'Author'], ['did:plc:r1', 'R1'], ['did:plc:r2', 'R2'], ['did:plc:r3', 'R3'], ['did:plc:staff', 'Staff']]) {
    records.push([`at://${did}/${NS}.actor.profile/self`, did, `${NS}.actor.profile`, 'self', profile(name), `p-${name}`, '2020-01-01T00:00:00Z']);
  }
  const threadRows: [string, string, string, string, string, string[], boolean, boolean, string | null][] = [
    [OLD, BOARD, 'did:plc:author', 'An old featured welcome', '2020-01-01T00:00:00Z', ['welcome'], false, false, null],
    [SEARCH, BOARD, 'did:plc:author', 'Literal 100%_ title', '2026-01-01T10:00:00Z', ['help', 'search'], false, true, '2026-01-01T12:00:00Z'],
    [HIDDEN, BOARD, 'did:plc:author', 'Hidden help', '2026-01-02T00:00:00Z', ['help'], true, false, null],
    [PRIVATE_THREAD, PRIVATE, 'did:plc:author', 'Private help', '2026-01-03T00:00:00Z', ['help'], false, false, null],
    [BANNED, BOARD, 'did:plc:banned', 'Banned help', '2026-01-04T00:00:00Z', ['help'], false, false, null],
    [`at://did:plc:peer/${NS}.discussion.thread/peer`, PEER, 'did:plc:peer-author', 'Peer visible', '2026-01-05T00:00:00Z', [], false, false, null],
    [`at://did:plc:blocked/${NS}.discussion.thread/blocked`, BLOCKED, 'did:plc:blocked-author', 'Blocked peer', '2026-01-06T00:00:00Z', [], false, false, null],
    [`at://did:plc:delisted/${NS}.discussion.thread/delisted`, DELISTED, 'did:plc:delisted-author', 'Delisted peer', '2026-01-07T00:00:00Z', [], false, false, null],
  ];
  for (const [uri, board, author, title, created, tags, hidden, locked, lockedAt] of threadRows) {
    records.push([uri, author, `${NS}.discussion.thread`, uri.split('/').at(-1)!, threadRecord(board, title, tags), `c-${title}`, created]);
    await sql`INSERT INTO atmobb_thread_stats ${sql({
      thread_uri: uri, board_uri: board, author_did: author, title, created_at: created,
      reply_count: uri === SEARCH ? 8 : 0, last_activity: uri === SEARCH ? '2026-01-01T14:00:00Z' : created,
      last_reply_did: uri === SEARCH ? 'did:plc:staff' : null, hidden, locked, locked_at: lockedAt, pinned: false,
    })}`;
  }

  const replies: [string, string, string][] = [
    ['did:plc:r1', 'r1', '2026-01-01T11:00:00Z'],
    ['did:plc:r2', 'r2-old', '2026-01-01T10:30:00Z'],
    ['did:plc:r2', 'r2-new', '2026-01-01T11:30:00Z'],
    ['did:plc:r3', 'r3', '2026-01-01T09:00:00Z'],
    ['did:plc:reply-banned', 'banned', '2026-01-01T11:45:00Z'],
    ['did:plc:post-lock', 'post-lock', '2026-01-01T13:00:00Z'],
    ['did:plc:staff', 'staff', '2026-01-01T14:00:00Z'],
  ];
  for (const [did, rkey, at] of replies) {
    const uri = `at://${did}/${NS}.discussion.reply/${rkey}`;
    records.push([uri, did, `${NS}.discussion.reply`, rkey, JSON.stringify({ thread: { uri: SEARCH } }), `r-${rkey}`, at]);
    await sql`INSERT INTO happyview_record_refs ${sql({ source_uri: uri, target_uri: SEARCH })}`;
  }
  for (const row of records) {
    await sql`INSERT INTO happyview_records ${sql({ uri: row[0], did: row[1], collection: row[2], rkey: row[3], record: row[4], cid: row[5], created_at: row[6] })}`;
  }
  await sql`INSERT INTO atmobb_delisted_forums ${sql({ did: 'did:plc:delisted' })}`;
  await sql`INSERT INTO atmobb_bans ${sql({ uri: 'ban-thread', forum_did: F, did: 'did:plc:banned', board_uri: null, since: '2000-01-01T00:00:00Z', until: null })}`;
  await sql`INSERT INTO atmobb_bans ${sql({ uri: 'ban-reply', forum_did: F, did: 'did:plc:reply-banned', board_uri: null, since: '2000-01-01T00:00:00Z', until: null })}`;
  await sql`INSERT INTO happyview_records ${sql({
    uri: `at://${F}/${NS}.forum.moderator/staff`, did: F, collection: `${NS}.forum.moderator`, rkey: 'staff',
    record: JSON.stringify({ subject: 'did:plc:staff' }), cid: 'm1', created_at: '2020-01-01T00:00:00Z',
  })}`;
  await sql`INSERT INTO happyview_records ${sql({
    uri: `at://${F}/${NS}.moderation.action/block`, did: F, collection: `${NS}.moderation.action`, rkey: 'block',
    record: JSON.stringify({ action: 'block', subject: { did: 'did:plc:blocked' } }), cid: 'a1', created_at: '2026-01-01T00:00:00Z',
  })}`;
}

run('thread list SQL integration', () => {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  const queries = exactQueries();
  const latestParams = (filters: { q?: string; board?: string; tag?: string; uri?: string } = {}, limit = 25, offset = 0) => [
    `${NS}.actor.profile`, limit, offset, `${NS}.forum.board`, `${NS}.forum.profile`, `at://${F}/%`, F,
    `${NS}.moderation.action`, filters.q ?? '', filters.board ?? '', filters.tag ?? '',
    `${NS}.discussion.reply`, `${NS}.forum.moderator`, filters.uri ?? '',
  ];
  const boardParams = (q = '', tag = '', limit = 25, offset = 0) => [
    BOARD, `${NS}.forum.board`, `${NS}.moderation.action`, F, limit, offset,
    `${NS}.forum.profile`, `${NS}.actor.profile`, q, tag, `${NS}.discussion.reply`, `${NS}.forum.moderator`,
  ];

  beforeAll(() => fixtures(sql));
  afterAll(() => sql.end());

  it('combines literal title, board and tag filters without changing visibility', async () => {
    const rows = await sql.unsafe(queries.latestRows, latestParams({ q: '100%_', board: BOARD, tag: 'HELP' }));
    expect(rows.map((row) => row.thread_uri)).toEqual([SEARCH]);
  });

  it('returns an old exact URI outside the recent limit, but never hidden or private exact URIs', async () => {
    expect((await sql.unsafe(queries.latestRows, latestParams({}, 1))).map((row) => row.thread_uri)).not.toContain(OLD);
    expect((await sql.unsafe(queries.latestRows, latestParams({ uri: OLD }, 1))).map((row) => row.thread_uri)).toEqual([OLD]);
    expect(await sql.unsafe(queries.latestRows, latestParams({ uri: HIDDEN }, 1))).toHaveLength(0);
    expect(await sql.unsafe(queries.latestRows, latestParams({ uri: PRIVATE_THREAD }, 1))).toHaveLength(0);
  });

  it('keeps only visible federated threads and excludes hidden, banned, private, blocked and delisted rows', async () => {
    const uris = (await sql.unsafe(queries.latestRows, latestParams())).map((row) => row.thread_uri);
    expect(uris).toContain(`at://did:plc:peer/${NS}.discussion.thread/peer`);
    for (const excluded of [HIDDEN, PRIVATE_THREAD, BANNED]) expect(uris).not.toContain(excluded);
    expect(uris.some((uri) => uri.includes('blocked') || uri.includes('delisted'))).toBe(false);
  });

  it('orders, bounds and deduplicates actual visible participants', async () => {
    const [row] = await sql.unsafe(queries.latestRows, latestParams({ uri: SEARCH }));
    expect(row.participants.map((participant: { did: string }) => participant.did)).toEqual([
      'did:plc:author', 'did:plc:staff', 'did:plc:r2', 'did:plc:r1', 'did:plc:r3',
    ]);
  });

  it('executes board count and rows SQL with combined filters and the same exclusions', async () => {
    const count = await sql.unsafe(queries.boardFiltered, [BOARD, `${NS}.forum.board`, `${NS}.moderation.action`, F, '100%_', 'HELP']);
    expect(count[0].thread_count).toBe(1);
    const rows = await sql.unsafe(queries.boardRows, boardParams('100%_', 'HELP'));
    expect(rows.map((row) => row.thread_uri)).toEqual([SEARCH]);
    expect(rows[0].participants.map((participant: { did: string }) => participant.did)).toEqual([
      'did:plc:author', 'did:plc:staff', 'did:plc:r2', 'did:plc:r1', 'did:plc:r3',
    ]);
    const all = await sql.unsafe(queries.boardRows, boardParams());
    const allUris = all.map((row) => row.thread_uri);
    expect(allUris).toContain(`at://did:plc:peer/${NS}.discussion.thread/peer`);
    for (const excluded of [HIDDEN, PRIVATE_THREAD, BANNED]) expect(allUris).not.toContain(excluded);
    expect(allUris.some((uri) => uri.includes('blocked') || uri.includes('delisted'))).toBe(false);
    const second = await sql.unsafe(queries.boardRows, boardParams('', '', 1, 1));
    expect(second.map((row) => row.thread_uri)).toEqual([SEARCH]);
  });
});
