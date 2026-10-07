import fs from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

const NS = 'app.atmobb';
const F = 'did:plc:forum';
const OTHER_FORUM = 'did:plc:other-forum';

/** The getGuestbook statements (entries, then the open flag and viewer block), run exactly as the script sends them. */
function guestbookStatements(): [string, string] {
  const text = fs.readFileSync(new URL('./lua/getGuestbook.lua', import.meta.url), 'utf8');
  const matches = [...text.matchAll(/db\.raw\(\[\[([\s\S]*?)\]\], \{/g)];
  if (matches.length !== 2) throw new Error('Could not extract the getGuestbook statements from Lua source');
  return [matches[0][1], matches[1][1]];
}

run('guestbook SQL integration', () => {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  const [statement, stateStatement] = guestbookStatements();
  // One clock for the whole suite; every time below is hours before it.
  const now = Date.now();
  const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

  const guestbook = async (
    subject: string,
    opts: { forum?: string; includeHidden?: boolean; limit?: number; offset?: number } = {},
  ) => {
    const rows = await sql.unsafe(statement, [
      opts.forum ?? F, subject, `${NS}.actor.guestbook`, `${NS}.forum.membership`, `${NS}.moderation.action`,
      opts.includeHidden ? 'true' : 'false', opts.limit ?? 20, opts.offset ?? 0,
    ]);
    return rows.map((row) => (row.hidden ? [row.uri, row.hidden] : row.uri));
  };

  /** What the script reports beside the entries: open, and whether `viewer` is blocked. */
  const state = async (subject: string, viewer = '', forum = F) => {
    const rows = await sql.unsafe(stateStatement, [forum, subject, viewer, `${NS}.forum.membership`]);
    return { open: rows.length > 0, viewerBlocked: rows.length > 0 && rows[0].viewer_blocked === 'yes' };
  };

  let rkeys = 0;
  const record = async (did: string, collection: string, record: object, indexedAt: string) => {
    const rkey = `k${(rkeys += 1)}`;
    const uri = `at://${did}/${collection}/${rkey}`;
    await sql`INSERT INTO happyview_records ${sql({
      uri, did, collection, rkey, record: JSON.stringify(record), cid: `c-${rkey}`, created_at: indexedAt,
    })}`;
    return uri;
  };
  /** A signed entry, indexed `hours` ago; its own createdAt claims long ago. */
  const sign = (signer: string, subject: string, hours: number, forum = F) =>
    record(signer, `${NS}.actor.guestbook`, { forum, subject, text: `hi from ${signer}`, createdAt: '2000-01-01T00:00:00Z' }, hoursAgo(hours));
  /** The owner's membership declaration, newest by createdAt `hours` ago. */
  const declare = (owner: string, fields: object, hours = 1000, forum = F) =>
    record(owner, `${NS}.forum.membership`, { forum, createdAt: hoursAgo(hours), ...fields }, hoursAgo(hours));
  const moderate = (action: string, uri: string, hours: number) =>
    record(F, `${NS}.moderation.action`, { action, subject: { uri, cid: 'x' } }, hoursAgo(hours));
  const ban = (did: string, until: string | null = null, forum = F) =>
    sql`INSERT INTO atmobb_bans ${sql({ uri: `ban-${did}-${(rkeys += 1)}`, forum_did: forum, did, board_uri: null, since: hoursAgo(5000), until })}`;

  beforeAll(async () => {
    await sql.unsafe(`
      CREATE TEMP TABLE happyview_records (
        uri text PRIMARY KEY, did text NOT NULL, collection text NOT NULL, rkey text NOT NULL,
        record text NOT NULL, cid text, created_at text NOT NULL
      );
      CREATE TEMP TABLE atmobb_bans (
        uri text PRIMARY KEY, forum_did text, did text, board_uri text, since text, until text
      );
      CREATE TEMP TABLE atmobb_member_windows (
        action_uri text PRIMARY KEY, forum_did text, did text, since text, until text, sponsor text, via text
      );
      CREATE TEMP TABLE atmobb_forum_gating (
        action_uri text PRIMARY KEY, forum_did text, gated_since text, opened_at text, mode text
      );
    `);
  });
  afterAll(() => sql.end());

  it('shows entries only for the asked forum and subject, newest first by index time', async () => {
    const owner = 'did:plc:owner-scope';
    await declare(owner, { guestbook: true });
    await declare(owner, { guestbook: true }, 1000, OTHER_FORUM);
    const older = await sign('did:plc:a', owner, 30);
    const newer = await sign('did:plc:b', owner, 20);
    const elsewhere = await sign('did:plc:c', owner, 10, OTHER_FORUM);
    await sign('did:plc:d', 'did:plc:someone-else', 10);
    expect(await guestbook(owner)).toEqual([newer, older]);
    expect(await guestbook(owner, { forum: OTHER_FORUM })).toEqual([elsewhere]);
  });

  it('shows nothing while the owner has the guestbook off, and follows their newest declaration', async () => {
    const owner = 'did:plc:owner-flag';
    const entry = await sign('did:plc:a', owner, 10);
    expect(await guestbook(owner)).toEqual([]);
    await declare(owner, { guestbook: false }, 500);
    expect(await guestbook(owner)).toEqual([]);
    await declare(owner, { guestbook: true }, 400);
    expect(await guestbook(owner)).toEqual([entry]);
    await declare(owner, { guestbook: 'true' }, 300);
    expect(await guestbook(owner)).toEqual([]);
  });

  it('AE7: an entry indexed while closed stays out after reopening; one from before the closure comes back', async () => {
    const owner = 'did:plc:owner-closed';
    const firstOpen = await sign('did:plc:a', owner, 100);
    const whileClosed = await sign('did:plc:b', owner, 50);
    const neverOpen = await sign('did:plc:c', owner, 300);
    // Opened 200h ago (closed from the beginning until then), closed 60h ago, opened again 40h ago.
    await declare(owner, { guestbook: false, guestbookClosed: [{ from: '1970-01-01T00:00:00Z', to: hoursAgo(200) }, { from: hoursAgo(60) }] }, 60);
    expect(await guestbook(owner)).toEqual([]);
    await declare(owner, {
      guestbook: true,
      guestbookClosed: [{ from: '1970-01-01T00:00:00Z', to: hoursAgo(200) }, { from: hoursAgo(60), to: hoursAgo(40) }],
    }, 40);
    expect(await guestbook(owner)).toEqual([firstOpen]);
    expect(await guestbook(owner, { includeHidden: true })).toEqual([firstOpen]);
    expect(await guestbook(owner)).not.toContain(whileClosed);
    expect(await guestbook(owner)).not.toContain(neverOpen);
  });

  it('drops a banned signer\'s entries and brings them back after an unban or once the ban ends', async () => {
    const owner = 'did:plc:owner-ban';
    await declare(owner, { guestbook: true });
    const unbanned = await sign('did:plc:unbanned', owner, 10);
    const expiring = await sign('did:plc:expiring', owner, 9);
    await ban('did:plc:unbanned');
    await ban('did:plc:expiring', new Date(now + 3_600_000).toISOString());
    // A ban on another forum changes nothing here.
    const elsewhereBanned = await sign('did:plc:elsewhere-banned', owner, 8);
    await ban('did:plc:elsewhere-banned', null, OTHER_FORUM);
    expect(await guestbook(owner, { includeHidden: true })).toEqual([elsewhereBanned]);

    await sql`DELETE FROM atmobb_bans WHERE did = 'did:plc:unbanned'`;
    await sql`UPDATE atmobb_bans SET until = ${hoursAgo(1)} WHERE did = 'did:plc:expiring'`;
    expect(await guestbook(owner)).toEqual([elsewhereBanned, expiring, unbanned]);
  });

  it('shows nothing while the owner is banned forum-wide', async () => {
    const owner = 'did:plc:owner-banned';
    await declare(owner, { guestbook: true });
    await sign('did:plc:a', owner, 10);
    await ban(owner);
    expect(await guestbook(owner, { includeHidden: true })).toEqual([]);
  });

  it('on a gated forum, keeps signers with an open membership window and the forum account', async () => {
    const gated = 'did:plc:gated-forum';
    const owner = 'did:plc:owner-gated';
    await declare(owner, { guestbook: true }, 1000, gated);
    const member = await sign('did:plc:member', owner, 10, gated);
    await sign('did:plc:outsider', owner, 9, gated);
    await sign('did:plc:former', owner, 8, gated);
    const fromForum = await sign(gated, owner, 7, gated);
    await sql`INSERT INTO atmobb_forum_gating ${sql({ action_uri: 'gate-g', forum_did: gated, gated_since: hoursAgo(5000), opened_at: null, mode: 'apply' })}`;
    await sql`INSERT INTO atmobb_member_windows ${sql({ action_uri: 'w-member', forum_did: gated, did: 'did:plc:member', since: hoursAgo(5000), until: null, sponsor: null, via: 'founding' })}`;
    await sql`INSERT INTO atmobb_member_windows ${sql({ action_uri: 'w-former', forum_did: gated, did: 'did:plc:former', since: hoursAgo(5000), until: hoursAgo(100), sponsor: null, via: 'founding' })}`;
    expect(await guestbook(owner, { forum: gated, includeHidden: true })).toEqual([fromForum, member]);
  });

  it('follows the forum\'s latest hide or unhide, and flags a staff hide with includeHidden', async () => {
    const owner = 'did:plc:owner-staff';
    await declare(owner, { guestbook: true });
    const entry = await sign('did:plc:a', owner, 10);
    await moderate('hide', entry, 9);
    expect(await guestbook(owner)).toEqual([]);
    expect(await guestbook(owner, { includeHidden: true })).toEqual([[entry, 'staff']]);
    // A hide signed by anyone other than the forum account is not the forum's.
    await moderate('unhide', entry, 8);
    expect(await guestbook(owner)).toEqual([entry]);
    await record('did:plc:stranger', `${NS}.moderation.action`, { action: 'hide', subject: { uri: entry, cid: 'x' } }, hoursAgo(7));
    expect(await guestbook(owner)).toEqual([entry]);
  });

  it('drops entries the owner hid or whose signer they blocked, and flags them with includeHidden', async () => {
    const owner = 'did:plc:owner-hides';
    const kept = await sign('did:plc:kept', owner, 12);
    const hidden = await sign('did:plc:hidden', owner, 11);
    const blocked = await sign('did:plc:blocked', owner, 10);
    await declare(owner, { guestbook: true, guestbookHidden: [hidden], guestbookBlocked: ['did:plc:blocked'] });
    expect(await guestbook(owner)).toEqual([kept]);
    expect(await guestbook(owner, { includeHidden: true })).toEqual([[blocked, 'blocked'], [hidden, 'owner'], kept]);
  });

  it('keeps one entry per signer in any 24 hours, and hiding the first does not free the window', async () => {
    const owner = 'did:plc:owner-burst';
    await declare(owner, { guestbook: true });
    const burst = [];
    for (const minutes of [60, 45, 30, 15, 1]) burst.push(await sign('did:plc:eager', owner, 30 + minutes / 60));
    const nextDay = await sign('did:plc:eager', owner, 31 - 25);
    const other = await sign('did:plc:calm', owner, 30.5);
    expect(await guestbook(owner)).toEqual([nextDay, other, burst[0]]);
    expect(await guestbook(owner, { includeHidden: true })).toEqual([nextDay, other, burst[0]]);

    await declare(owner, { guestbook: true, guestbookHidden: [burst[0]] }, 900);
    expect(await guestbook(owner)).toEqual([nextDay, other]);
  });

  it('forgets a deleted entry', async () => {
    const owner = 'did:plc:owner-delete';
    await declare(owner, { guestbook: true });
    const entry = await sign('did:plc:a', owner, 10);
    expect(await guestbook(owner)).toEqual([entry]);
    await sql`DELETE FROM happyview_records WHERE uri = ${entry}`;
    expect(await guestbook(owner)).toEqual([]);
  });

  it('returns each entry\'s cid for a strongRef', async () => {
    const owner = 'did:plc:owner-cid';
    await declare(owner, { guestbook: true });
    const entry = await sign('did:plc:a', owner, 10);
    const rows = await sql.unsafe(statement, [
      F, owner, `${NS}.actor.guestbook`, `${NS}.forum.membership`, `${NS}.moderation.action`, 'false', 20, 0,
    ]);
    expect(rows.map((row) => [row.uri, row.cid])).toEqual([[entry, `c-${entry.split('/').pop()}`]]);
  });

  it('reports the guestbook open only while the newest declaration has it on and the owner is not banned', async () => {
    const owner = 'did:plc:owner-state';
    expect(await state(owner)).toEqual({ open: false, viewerBlocked: false });
    await declare(owner, { guestbook: true, guestbookBlocked: ['did:plc:pest'] }, 500);
    expect(await state(owner)).toEqual({ open: true, viewerBlocked: false });
    expect(await state(owner, 'did:plc:pest')).toEqual({ open: true, viewerBlocked: true });
    expect(await state(owner, 'did:plc:friend')).toEqual({ open: true, viewerBlocked: false });
    expect((await state(owner, '', OTHER_FORUM)).open).toBe(false);
    await declare(owner, { guestbookBlocked: ['did:plc:pest'] }, 400);
    expect(await state(owner, 'did:plc:pest')).toEqual({ open: false, viewerBlocked: false });
    await declare(owner, { guestbook: true }, 300);
    expect(await state(owner)).toEqual({ open: true, viewerBlocked: false });
    await ban(owner);
    expect(await state(owner)).toEqual({ open: false, viewerBlocked: false });
  });

  it('pages newest first without repeats or gaps', async () => {
    const owner = 'did:plc:owner-pages';
    await declare(owner, { guestbook: true });
    const entries = [];
    for (let n = 0; n < 7; n += 1) entries.push(await sign(`did:plc:p${n}`, owner, 100 - n));
    const newestFirst = [...entries].reverse();
    const pages = [];
    for (let offset = 0; offset < 9; offset += 3) pages.push(...(await guestbook(owner, { limit: 3, offset })));
    expect(pages).toEqual(newestFirst);
  });
});
