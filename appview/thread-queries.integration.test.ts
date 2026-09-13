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
// Threads on F while it was gated (2021-01-01 to 2021-06-01, then 2021-09-01
// to 2022-01-01), between those periods, and by the forum account itself.
const GATED_MEMBER = `at://did:plc:member/${NS}.discussion.thread/gated-member`;
const GATED_OUTSIDER = `at://did:plc:outsider/${NS}.discussion.thread/gated-outsider`;
const BETWEEN_GATES = `at://did:plc:outsider/${NS}.discussion.thread/between`;
const GATED_FORMER = `at://did:plc:former/${NS}.discussion.thread/gated-former`;
const GATED_FORUM = `at://${F}/${NS}.discussion.thread/gated-forum`;

function source(path: string): string {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

function capture(text: string, pattern: RegExp, label: string): string[] {
  const match = text.match(pattern);
  if (!match) throw new Error(`Could not extract ${label} from Lua source`);
  return match.slice(1);
}

/** The db.raw([[ ... ]], { statement in a Lua source that mentions marker. */
function statement(text: string, marker: string, label: string): string {
  const bodies = [...text.matchAll(/db\.raw\(\[\[([\s\S]*?)\]\], \{/g)].map((match) => match[1]);
  const found = bodies.find((body) => body.includes(marker));
  if (!found) throw new Error(`Could not extract ${label} from Lua source`);
  return found;
}

/** The semicolon-terminated block of infra/rebuild-stats.sql that mentions marker. */
function rebuildBlock(marker: string): string {
  const found = source('../infra/rebuild-stats.sql').split(/;\s*\n/).find((block) => block.includes(marker));
  if (!found) throw new Error(`Could not extract ${marker} block from rebuild-stats.sql`);
  return found;
}

function stampStatements() {
  const action = source('./lua/onModerationAction.lua');
  return {
    threadFirsts: statement(source('./lua/onThreadCreate.lua'), 'INSERT INTO atmobb_firsts', 'thread firsts'),
    replyFirsts: statement(source('./lua/onReplyCreate.lua'), 'INSERT INTO atmobb_firsts', 'reply firsts'),
    award: statement(action, 'INSERT INTO atmobb_stamp_awards', 'stamp award'),
    revoke: statement(action, 'UPDATE atmobb_stamp_awards', 'stamp revoke'),
    rebuildFirsts: rebuildBlock('INSERT INTO atmobb_firsts'),
    rebuildAwards: rebuildBlock('INSERT INTO atmobb_stamp_awards'),
  };
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
    CREATE TEMP TABLE atmobb_member_windows (
      action_uri text PRIMARY KEY, forum_did text, did text, since text, until text, sponsor text, via text
    );
    CREATE TEMP TABLE atmobb_forum_gating (
      action_uri text PRIMARY KEY, forum_did text, gated_since text, opened_at text, mode text
    );
    CREATE TEMP TABLE atmobb_firsts (
      forum_did text NOT NULL, did text NOT NULL, board_uri text, first_at text NOT NULL, source_uri text NOT NULL,
      UNIQUE NULLS NOT DISTINCT (forum_did, did, board_uri)
    );
    CREATE TEMP TABLE atmobb_stamp_awards (
      forum_did text NOT NULL, did text NOT NULL, stamp_uri text NOT NULL, actor_did text,
      created_at text NOT NULL, revoked_at text,
      PRIMARY KEY (forum_did, did, stamp_uri)
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
    [GATED_MEMBER, BOARD, 'did:plc:member', 'Member while gated', '2021-02-01T00:00:00Z', [], false, false, null],
    [GATED_OUTSIDER, BOARD, 'did:plc:outsider', 'Outsider while gated', '2021-02-01T00:00:00Z', [], false, false, null],
    [BETWEEN_GATES, BOARD, 'did:plc:outsider', 'Outsider while open', '2021-07-01T00:00:00Z', [], false, false, null],
    [GATED_FORMER, BOARD, 'did:plc:former', 'Former member while gated', '2021-10-01T00:00:00Z', [], false, false, null],
    [GATED_FORUM, BOARD, F, 'Forum account while gated', '2021-10-02T00:00:00Z', [], false, false, null],
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
  await sql`INSERT INTO atmobb_forum_gating ${sql({ action_uri: 'gate-1', forum_did: F, gated_since: '2021-01-01T00:00:00Z', opened_at: '2021-06-01T00:00:00Z', mode: 'apply' })}`;
  await sql`INSERT INTO atmobb_forum_gating ${sql({ action_uri: 'gate-2', forum_did: F, gated_since: '2021-09-01T00:00:00Z', opened_at: '2022-01-01T00:00:00Z', mode: 'invite' })}`;
  await sql`INSERT INTO atmobb_member_windows ${sql({ action_uri: 'accept-member', forum_did: F, did: 'did:plc:member', since: '2021-01-01T00:00:00Z', until: null, sponsor: null, via: 'founding' })}`;
  await sql`INSERT INTO atmobb_member_windows ${sql({ action_uri: 'accept-former', forum_did: F, did: 'did:plc:former', since: '2021-01-01T00:00:00Z', until: '2021-09-15T00:00:00Z', sponsor: null, via: 'founding' })}`;
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

  it('serves a gated forum\'s threads only from members, the forum account, or while it was open', async () => {
    const uris = (await sql.unsafe(queries.latestRows, latestParams())).map((row) => row.thread_uri);
    for (const served of [GATED_MEMBER, BETWEEN_GATES, GATED_FORUM]) expect(uris).toContain(served);
    for (const hidden of [GATED_OUTSIDER, GATED_FORMER]) expect(uris).not.toContain(hidden);
    const board = (await sql.unsafe(queries.boardRows, boardParams())).map((row) => row.thread_uri);
    for (const served of [GATED_MEMBER, BETWEEN_GATES, GATED_FORUM]) expect(board).toContain(served);
    for (const hidden of [GATED_OUTSIDER, GATED_FORMER]) expect(board).not.toContain(hidden);
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

// Stamps: the first-seen rows the create triggers write, the by-hand awards
// the moderation trigger indexes, and the rebuild that reproduces both.
run('stamp trigger SQL integration', () => {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  const queries = stampStatements();
  const SECOND = `at://${F}/${NS}.forum.board/second`;
  const SECOND_THREAD = `at://did:plc:author/${NS}.discussion.thread/second`;
  const HUSHED = `at://did:plc:hushed/${NS}.discussion.thread/hushed`;
  const LONE = `at://did:plc:lone/${NS}.discussion.thread/lone`;
  const STAMP = `at://${F}/${NS}.forum.stamp/helper`;
  const reply = (rkey: string) => `at://did:plc:newbie/${NS}.discussion.reply/${rkey}`;
  const plain = <T extends object>(rows: readonly T[]) => rows.map((row) => ({ ...row }));

  const threadFirsts = (uri: string, board: string, author: string, at: string) =>
    sql.unsafe(queries.threadFirsts, [uri, board, author, at, `${NS}.forum.board`]);
  const replyFirsts = (uri: string, thread: string, author: string, at: string) =>
    sql.unsafe(queries.replyFirsts, [uri, thread, author, at, `${NS}.forum.board`]);
  const award = (forum: string, member: string, actor: string, at: string) =>
    sql.unsafe(queries.award, [forum, member, STAMP, actor, at]);
  const revoke = (forum: string, member: string, at: string) =>
    sql.unsafe(queries.revoke, [forum, member, STAMP, at]);
  const firsts = async (did: string) => plain(await sql`
    SELECT board_uri, first_at, source_uri FROM atmobb_firsts
    WHERE forum_did = ${F} AND did = ${did} ORDER BY board_uri NULLS FIRST`);
  const allFirsts = async () => plain(await sql`
    SELECT forum_did, did, board_uri, first_at, source_uri FROM atmobb_firsts
    ORDER BY forum_did, did, board_uri NULLS FIRST`);
  const awards = async () => plain(await sql`
    SELECT forum_did, did, stamp_uri, actor_did, created_at, revoked_at FROM atmobb_stamp_awards
    ORDER BY forum_did, did, stamp_uri`);

  beforeAll(async () => {
    await fixtures(sql);
    // A second public board on F with one thread, and a fresh author whose
    // only thread the forum hid after the fact.
    await sql`INSERT INTO happyview_records ${sql({
      uri: SECOND, did: F, collection: `${NS}.forum.board`, rkey: 'second',
      record: boardRecord('Second', { topic: 'own' }), cid: 'b6', created_at: '2020-01-01T00:00:00Z',
    })}`;
    for (const [uri, board, author, title, created, hidden] of [
      [SECOND_THREAD, SECOND, 'did:plc:author', 'Second board thread', '2026-01-09T00:00:00Z', false],
      [HUSHED, BOARD, 'did:plc:hushed', 'Hidden since', '2026-01-08T00:00:00Z', true],
    ] as const) {
      await sql`INSERT INTO happyview_records ${sql({
        uri, did: author, collection: `${NS}.discussion.thread`, rkey: uri.split('/').at(-1)!,
        record: threadRecord(board, title), cid: `c-${title}`, created_at: created,
      })}`;
      await sql`INSERT INTO atmobb_thread_stats ${sql({
        thread_uri: uri, board_uri: board, author_did: author, title, created_at: created,
        reply_count: 0, last_activity: created, last_reply_did: null, hidden, locked: false, locked_at: null, pinned: false,
      })}`;
    }
  });
  afterAll(() => sql.end());

  it('AE3: a first reply in a board writes one board row and one forum row, and the next writes nothing', async () => {
    await replyFirsts(reply('one'), SEARCH, 'did:plc:newbie', '2026-01-10T00:00:00Z');
    const expected = [
      { board_uri: null, first_at: '2026-01-10T00:00:00Z', source_uri: reply('one') },
      { board_uri: BOARD, first_at: '2026-01-10T00:00:00Z', source_uri: reply('one') },
    ];
    expect(await firsts('did:plc:newbie')).toEqual(expected);
    await replyFirsts(reply('two'), SEARCH, 'did:plc:newbie', '2026-01-11T00:00:00Z');
    expect(await firsts('did:plc:newbie')).toEqual(expected);
  });

  it('a reply in a second board writes a board row only', async () => {
    await replyFirsts(reply('three'), SECOND_THREAD, 'did:plc:newbie', '2026-01-12T00:00:00Z');
    expect(await firsts('did:plc:newbie')).toEqual([
      { board_uri: null, first_at: '2026-01-10T00:00:00Z', source_uri: reply('one') },
      { board_uri: BOARD, first_at: '2026-01-10T00:00:00Z', source_uri: reply('one') },
      { board_uri: SECOND, first_at: '2026-01-12T00:00:00Z', source_uri: reply('three') },
    ]);
  });

  it('deleting the qualifying thread leaves the firsts rows in place', async () => {
    expect(source('./lua/onThreadDelete.lua')).not.toContain('atmobb_firsts');
    expect(source('./lua/onReplyDelete.lua')).not.toContain('atmobb_firsts');
    await sql`INSERT INTO atmobb_thread_stats ${sql({
      thread_uri: LONE, board_uri: BOARD, author_did: 'did:plc:lone', title: 'Lone', created_at: '2026-01-13T00:00:00Z',
      reply_count: 0, last_activity: '2026-01-13T00:00:00Z', last_reply_did: null, hidden: false, locked: false, locked_at: null, pinned: false,
    })}`;
    await threadFirsts(LONE, BOARD, 'did:plc:lone', '2026-01-13T00:00:00Z');
    const expected = [
      { board_uri: null, first_at: '2026-01-13T00:00:00Z', source_uri: LONE },
      { board_uri: BOARD, first_at: '2026-01-13T00:00:00Z', source_uri: LONE },
    ];
    expect(await firsts('did:plc:lone')).toEqual(expected);
    await sql`DELETE FROM atmobb_thread_stats WHERE thread_uri = ${LONE}`;
    expect(await firsts('did:plc:lone')).toEqual(expected);
  });

  it('a thread in a space board or on a delisted forum writes nothing', async () => {
    await threadFirsts(PRIVATE_THREAD, PRIVATE, 'did:plc:spacer', '2026-01-03T00:00:00Z');
    expect(await firsts('did:plc:spacer')).toEqual([]);
    await threadFirsts(`at://did:plc:delisted-author/${NS}.discussion.thread/delisted`, DELISTED, 'did:plc:delisted-author', '2026-01-07T00:00:00Z');
    expect(await sql`SELECT 1 FROM atmobb_firsts WHERE forum_did = 'did:plc:delisted'`).toHaveLength(0);
  });

  it('on a gated forum, a post outside the author\'s membership window writes nothing', async () => {
    await threadFirsts(GATED_OUTSIDER, BOARD, 'did:plc:outsider', '2021-02-01T00:00:00Z');
    expect(await firsts('did:plc:outsider')).toEqual([]);
    await threadFirsts(GATED_FORMER, BOARD, 'did:plc:former', '2021-10-01T00:00:00Z');
    expect(await firsts('did:plc:former')).toEqual([]);
    await threadFirsts(BETWEEN_GATES, BOARD, 'did:plc:outsider', '2021-07-01T00:00:00Z');
    expect((await firsts('did:plc:outsider')).map((row) => row.source_uri)).toEqual([BETWEEN_GATES, BETWEEN_GATES]);
    await threadFirsts(GATED_MEMBER, BOARD, 'did:plc:member', '2021-02-01T00:00:00Z');
    expect((await firsts('did:plc:member')).map((row) => row.source_uri)).toEqual([GATED_MEMBER, GATED_MEMBER]);
    await threadFirsts(GATED_FORUM, BOARD, F, '2021-10-02T00:00:00Z');
    expect((await firsts(F)).map((row) => row.source_uri)).toEqual([GATED_FORUM, GATED_FORUM]);
  });

  it('AE11: awardStamp records the actor, revokeStamp closes it, and a later awardStamp reopens it', async () => {
    await award(F, 'did:plc:r1', 'did:plc:staff', '2026-02-01T00:00:00Z');
    expect(await awards()).toEqual([
      { forum_did: F, did: 'did:plc:r1', stamp_uri: STAMP, actor_did: 'did:plc:staff', created_at: '2026-02-01T00:00:00Z', revoked_at: null },
    ]);
    await revoke(F, 'did:plc:r1', '2026-02-02T00:00:00Z');
    expect((await awards())[0].revoked_at).toBe('2026-02-02T00:00:00Z');
    await award(F, 'did:plc:r1', '', '2026-02-03T00:00:00Z');
    expect(await awards()).toEqual([
      { forum_did: F, did: 'did:plc:r1', stamp_uri: STAMP, actor_did: null, created_at: '2026-02-03T00:00:00Z', revoked_at: null },
    ]);
  });

  it('an awardStamp or revokeStamp signed by a DID other than the stamp\'s repo does nothing', async () => {
    await award('did:plc:peer', 'did:plc:r2', 'did:plc:staff', '2026-02-04T00:00:00Z');
    await revoke('did:plc:peer', 'did:plc:r1', '2026-02-04T00:00:00Z');
    expect(await awards()).toEqual([
      { forum_did: F, did: 'did:plc:r1', stamp_uri: STAMP, actor_did: null, created_at: '2026-02-03T00:00:00Z', revoked_at: null },
    ]);
  });

  it('rebuilding from indexed records reproduces live indexing, minus threads hidden since', async () => {
    await sql`TRUNCATE atmobb_firsts, atmobb_stamp_awards`;
    const threads = await sql`SELECT thread_uri, board_uri, author_did, created_at FROM atmobb_thread_stats ORDER BY created_at, thread_uri`;
    for (const t of threads) await threadFirsts(t.thread_uri, t.board_uri, t.author_did, t.created_at);
    const replies = await sql`
      SELECT uri, did, created_at, (record::jsonb)->'thread'->>'uri' AS thread FROM happyview_records
      WHERE collection = ${`${NS}.discussion.reply`} ORDER BY created_at, uri`;
    for (const r of replies) await replyFirsts(r.uri, r.thread, r.did, r.created_at);
    const actions: [string, string, string, string | null, string][] = [
      [F, 'did:plc:r1', 'awardStamp', 'did:plc:staff', '2026-02-01T00:00:00Z'],
      [F, 'did:plc:r1', 'revokeStamp', null, '2026-02-02T00:00:00Z'],
      [F, 'did:plc:r1', 'awardStamp', null, '2026-02-03T00:00:00Z'],
      [F, 'did:plc:r2', 'awardStamp', 'did:plc:staff', '2026-02-01T00:00:00Z'],
      [F, 'did:plc:r2', 'revokeStamp', 'did:plc:staff', '2026-02-05T00:00:00Z'],
      ['did:plc:peer', 'did:plc:r3', 'awardStamp', null, '2026-02-01T00:00:00Z'],
    ];
    for (const [i, [forum, member, action, actor, at]] of actions.entries()) {
      if (action === 'awardStamp') await award(forum, member, actor ?? '', at);
      else await revoke(forum, member, at);
      await sql`INSERT INTO happyview_records ${sql({
        uri: `at://${forum}/${NS}.moderation.action/stamp-${i}`, did: forum, collection: `${NS}.moderation.action`, rkey: `stamp-${i}`,
        record: JSON.stringify({ action, subject: { did: member }, ref: { uri: STAMP, cid: 's1' }, ...(actor ? { actor } : {}), createdAt: at }),
        cid: `a-stamp-${i}`, created_at: at,
      })}`;
    }
    const liveFirsts = await allFirsts();
    const liveAwards = await awards();
    expect(liveFirsts.filter((row) => row.did === 'did:plc:hushed')).toHaveLength(2);
    expect(liveAwards).toEqual([
      { forum_did: F, did: 'did:plc:r1', stamp_uri: STAMP, actor_did: null, created_at: '2026-02-03T00:00:00Z', revoked_at: null },
      { forum_did: F, did: 'did:plc:r2', stamp_uri: STAMP, actor_did: 'did:plc:staff', created_at: '2026-02-01T00:00:00Z', revoked_at: '2026-02-05T00:00:00Z' },
    ]);

    await sql`TRUNCATE atmobb_firsts, atmobb_stamp_awards`;
    await sql.unsafe(queries.rebuildFirsts);
    await sql.unsafe(queries.rebuildAwards);
    expect(await allFirsts()).toEqual(liveFirsts.filter((row) => row.did !== 'did:plc:hushed'));
    expect(await awards()).toEqual(liveAwards);
  });
});
