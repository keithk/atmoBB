import postgres from "postgres";
import { fileURLToPath } from "node:url";

const NS = "app.atmobb";
const FORUM_DID = "did:plc:atmobbdevforum";

const BOARDS = Number(process.env.BOARDS ?? 8);
const THREADS = Number(process.env.THREADS ?? 400);
const REPLIES = Number(process.env.REPLIES ?? 4_000);
const AUTHORS = Number(process.env.AUTHORS ?? 60);

const sql = postgres("postgres://happyview:happyview@127.0.0.1:5433/happyview");

// RESET=1 wipes previously seeded synthetic rows (dev DIDs only — real
// records indexed off the network stay) before reseeding. Without it,
// re-running duplicates boards/threads because rkeys are fresh tids.
if (process.env.RESET) {
  await sql`DELETE FROM happyview_record_refs WHERE source_uri LIKE 'at://did:plc:atmobbdev%'`;
  await sql`DELETE FROM happyview_records WHERE did LIKE 'did:plc:atmobbdev%' AND collection LIKE ${NS + ".%"}`;
  await sql`DELETE FROM atmobb_thread_stats`;
  await sql`DELETE FROM atmobb_post_counts`;
  console.log("reset: cleared dev-seeded rows and stats tables");
}

const B32 = "234567abcdefghijklmnopqrstuvwxyz";
let lastTid = 0n;
function tid(dateMs: number): string {
  let v = (BigInt(Math.floor(dateMs)) * 1000n << 10n) | BigInt(Math.floor(Math.random() * 1024));
  if (v <= lastTid) v = lastTid + 1n;
  lastTid = v;
  let s = "";
  for (let i = 12; i >= 0; i--) s += B32[Number((v >> BigInt(i * 5)) & 31n)];
  return s;
}

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rand(a.length)];
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.now();
const SPAN = 365 * 24 * 3600 * 1000;
const randomTime = (after = NOW - SPAN) =>
  Math.min(after + (NOW - after) * Math.pow(Math.random(), 0.5), NOW - 1000);

const text = (t: string) => ({ $type: `${NS}.richtext.block#text`, text: t });

type Row = {
  uri: string; did: string; collection: string; rkey: string;
  record: string; cid: string; created_at: string; refs: string[];
};

function makeRow(did: string, collection: string, rkey: string | null, value: Record<string, unknown>, atMs: number): Row {
  const key = rkey ?? tid(atMs);
  const record = { $type: collection, ...value };
  const json = JSON.stringify(record);
  const refs = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("at://")) refs.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(record);
  return {
    uri: `at://${did}/${collection}/${key}`,
    did, collection, rkey: key, record: json,
    cid: `bafydev${key}${rand(100000)}`, created_at: iso(atMs), refs: [...refs],
  };
}

async function insert(rows: Row[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map(r => ({
      uri: r.uri, did: r.did, collection: r.collection, rkey: r.rkey,
      record: r.record, cid: r.cid, indexed_at: r.created_at, created_at: r.created_at,
    }));
    await sql`INSERT INTO happyview_records ${sql(chunk)} ON CONFLICT (uri) DO NOTHING`;
    const refRows = rows.slice(i, i + 500).flatMap(r =>
      r.refs.map(t => ({ source_uri: r.uri, target_uri: t, collection: r.collection })));
    if (refRows.length) {
      await sql`INSERT INTO happyview_record_refs ${sql(refRows)} ON CONFLICT DO NOTHING`;
    }
  }
}

console.time("seed");

// Forum profile
await insert([makeRow(FORUM_DID, `${NS}.forum.profile`, "self", {
  name: "atmobb dev forum",
  description: "Synthetic forum for local development. Nothing here is real.",
  ranks: [
    { title: "New member", minPosts: 0 },
    { title: "Regular", minPosts: 10 },
    { title: "Frequent poster", minPosts: 50 },
    { title: "Veteran", minPosts: 200 },
  ],
  createdAt: iso(NOW - SPAN),
}, NOW - SPAN)]);

// Categories (board-index grouping bars)
const CATEGORY_NAMES = ["Discussion", "Backstage"];
const categoryRows = CATEGORY_NAMES.map((name, i) =>
  makeRow(FORUM_DID, `${NS}.forum.category`, null, {
    name,
    order: i,
    createdAt: iso(NOW - SPAN + i * 100),
  }, NOW - SPAN + i * 100),
);
await insert(categoryRows);

// Boards (a couple nested; top-level boards grouped into categories)
const BOARD_NAMES = [
  "General Discussion", "Introductions", "Tech Talk", "Off Topic",
  "Site Feedback", "Projects", "Retro Computing", "The Lounge",
];
const BOARD_DESCRIPTIONS = [
  "General conversation.",
  "Introduce yourself to the forum.",
  "Hardware, software, and everything in between.",
  "Anything that doesn't fit elsewhere.",
  "Questions and suggestions about the forum.",
  "Share what you're building.",
  "Old computers, software, and games.",
  "Relaxed conversation with other members.",
];
const boardRows: Row[] = [];
for (let i = 0; i < BOARDS; i++) {
  const parent = i >= 6 ? boardRows[i - 6].uri : undefined;
  const category = parent ? undefined : categoryRows[i < 4 ? 0 : 1].uri;
  boardRows.push(makeRow(FORUM_DID, `${NS}.forum.board`, null, {
    name: BOARD_NAMES[i % BOARD_NAMES.length],
    description: BOARD_DESCRIPTIONS[i % BOARD_DESCRIPTIONS.length],
    order: i,
    ...(parent ? { parent } : {}),
    ...(category ? { category } : {}),
    createdAt: iso(NOW - SPAN + i * 1000),
  }, NOW - SPAN + i * 1000));
}
// One topic board of our own: merges with every board tagged pop-culture
const myTopicBoard = makeRow(FORUM_DID, `${NS}.forum.board`, null, {
  name: "Pop Culture",
  description: "Threads from forums that use the pop-culture topic.",
  topic: "pop-culture",
  category: categoryRows[0].uri,
  order: BOARDS,
  createdAt: iso(NOW - SPAN + BOARDS * 1000),
}, NOW - SPAN + BOARDS * 1000);
boardRows.push(myTopicBoard);
await insert(boardRows);

// A neighboring forum: its own boards, one sharing a topic with ours, so
// the merged stream has somewhere else to come from.
const NEIGHBOR_DID = "did:plc:atmobbdevneighbor";
await insert([makeRow(NEIGHBOR_DID, `${NS}.forum.profile`, "self", {
  name: "night city arcade",
  description: "A second forum used for local development.",
  createdAt: iso(NOW - SPAN + 7000),
}, NOW - SPAN + 7000)]);

const neighborTopicBoard = makeRow(NEIGHBOR_DID, `${NS}.forum.board`, null, {
  name: "The marquee",
  description: "Movies, music, and television.",
  topic: "pop-culture",
  order: 0,
  createdAt: iso(NOW - SPAN + 7500),
}, NOW - SPAN + 7500);
const neighborPlainBoard = makeRow(NEIGHBOR_DID, `${NS}.forum.board`, null, {
  name: "Cabinet repair",
  description: "Local discussion for this forum.",
  order: 1,
  createdAt: iso(NOW - SPAN + 7600),
}, NOW - SPAN + 7600);
await insert([neighborTopicBoard, neighborPlainBoard]);

// Authors with profiles + signatures
const FIRST = ["ada", "linus", "grace", "dennis", "margaret", "ken", "radia", "bjarne", "barbara", "donald"];
const SIGS = [
  "~ posting from my Amiga 500 ~",
  "carpe diem, carpe thread",
  "[b]this signature intentionally left bold[/b]",
  "ask me about my homelab",
  "est. 2004",
];
const authors = Array.from({ length: AUTHORS }, (_, i) => `did:plc:atmobbdevuser${i.toString().padStart(6, "0")}`);
await insert(authors.map((did, i) => makeRow(did, `${NS}.actor.profile`, "self", {
  displayName: `${pick(FIRST)}${100 + rand(900)}`,
  ...(Math.random() < 0.7 ? { signature: [text(pick(SIGS))] } : {}),
  ...(Math.random() < 0.3 ? { title: "Community member" } : {}),
  createdAt: iso(NOW - SPAN),
}, NOW - SPAN + i)));

// Memberships — joining is an act of the member, a record in their repo
await insert(
  authors
    .filter(() => Math.random() < 0.75)
    .map((did) => {
      const at = randomTime();
      return makeRow(did, `${NS}.forum.membership`, null, {
        forum: FORUM_DID,
        createdAt: iso(at),
      }, at);
    }),
);

// Staff — moderator records signed by the forum. ADMIN_DID (your real DID)
// gets admin so /admin works in dev with a real login.
const ADMIN_DID = process.env.ADMIN_DID ?? "did:plc:5qartdsce62n2wfyvtocmoob";
await insert([
  makeRow(FORUM_DID, `${NS}.forum.moderator`, null, {
    subject: ADMIN_DID,
    role: "admin",
    createdAt: iso(NOW - SPAN + 8000),
  }, NOW - SPAN + 8000),
  makeRow(FORUM_DID, `${NS}.forum.moderator`, null, {
    subject: authors[0],
    role: "moderator",
    createdAt: iso(NOW - SPAN + 9000),
  }, NOW - SPAN + 9000),
]);

// Threads
const TOPICS = [
  "What are you working on this week?",
  "Unpopular opinions",
  "Best keyboard under $100",
  "Share your desk setup",
  "Remember phpBB rank images?",
  "Is anyone else's RSS reader full of AI posts?",
  "Show us your terminal setup",
];
const threadRows: Row[] = [];
for (let i = 0; i < THREADS; i++) {
  const board = boardRows[Math.min(rand(BOARDS), rand(BOARDS))];
  const at = randomTime();
  // Every 25th thread carries a poll, alternating single and multiple choice.
  const poll = i % 25 === 0
    ? {
        question: `Poll for thread ${i}: which?`,
        options: ["Option A", "Option B", "Option C"],
        ...(i % 50 === 0 ? { multipleChoice: true } : {}),
      }
    : undefined;
  threadRows.push(makeRow(pick(authors), `${NS}.discussion.thread`, null, {
    board: board.uri,
    title: `${pick(TOPICS)} (#${i})`,
    body: [text(`This is a sample opening post for thread ${i}.`)],
    ...(poll ? { poll } : {}),
    createdAt: iso(at),
  }, at));
}
await insert(threadRows);

// Votes on the polls: a dozen authors each pick an option (two for the
// multiple-choice ones), as records in their own repos.
const voteRows: Row[] = [];
for (let i = 0; i < THREADS; i += 25) {
  const t = threadRows[i];
  for (const voter of authors.slice(0, 12)) {
    const picks = i % 50 === 0 ? [0, 1 + rand(2)] : [rand(3)];
    for (const option of picks) {
      const at = randomTime(Date.parse(t.created_at));
      voteRows.push(makeRow(voter, `${NS}.poll.vote`, null, {
        subject: { uri: t.uri, cid: t.cid },
        option,
        createdAt: iso(at),
      }, at));
    }
  }
}
await insert(voteRows);

// Threads on the topic boards — some posted here, some on the neighbor's
// same-topic board. The merge is the appview's job; records just point at
// their own forum's board.
const ATMO_TOPICS = [
  "Sequels that are better than the original",
  "Share your forum's theme",
  "Topics every forum has",
  "What brought you back to forums?",
  "How are shared threads working for you?",
];
const topicThreadRows: Row[] = [];
for (let i = 0; i < 60; i++) {
  const board = i % 2 === 0 ? myTopicBoard : neighborTopicBoard;
  const at = randomTime();
  topicThreadRows.push(makeRow(pick(authors), `${NS}.discussion.thread`, null, {
    board: board.uri,
    title: `${pick(ATMO_TOPICS)} (#${i})`,
    body: [text(`This is a sample post shared through the pop-culture topic (${i}).`)],
    createdAt: iso(at),
  }, at));
}
await insert(topicThreadRows);
threadRows.push(...topicThreadRows);

// The neighbor hides a thread on its own board — origin hides propagate, so
// it should vanish from our window too. (Odd indexes landed on the
// neighbor's board above; threads themselves live in their authors' repos.)
const hiddenThread = topicThreadRows[1];
await insert([makeRow(NEIGHBOR_DID, `${NS}.moderation.action`, null, {
  subject: { uri: hiddenThread.uri, cid: hiddenThread.cid },
  action: "hide",
  reason: "seeded test: hidden at its origin forum",
  createdAt: iso(NOW - 1000),
}, NOW - 1000)]);

// Replies
const replyRows: Row[] = [];
for (let i = 0; i < REPLIES; i++) {
  const t = threadRows[Math.min(rand(THREADS), rand(THREADS), rand(THREADS))];
  const at = randomTime(Date.parse(t.created_at));
  replyRows.push(makeRow(pick(authors), `${NS}.discussion.reply`, null, {
    thread: { uri: t.uri, cid: t.cid },
    body: [text(`This is sample reply ${i}.`)],
    createdAt: iso(at),
  }, at));
}
await insert(replyRows);

// Derive the stats tables from what we just inserted, the same way a
// backfill does, so the seed and the rebuild can't drift apart.
const rebuild = fileURLToPath(new URL("../infra/rebuild-stats.sql", import.meta.url));
await sql.begin((tx) => tx.file(rebuild));

console.timeEnd("seed");
const counts = await sql`SELECT collection, count(*) FROM happyview_records WHERE collection LIKE 'app.atmobb%' GROUP BY collection ORDER BY collection`;
console.table(counts);
await sql.end();
