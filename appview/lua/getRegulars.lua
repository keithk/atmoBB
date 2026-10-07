-- xrpc.query:app.atmobb.actor.getRegulars
-- The members an actor talks with most on one forum: those who replied in at
-- least two of the same public threads as the actor over the last 180 days.
-- Only replies count, so someone who only ever answers the actor's own
-- threads (where the actor never replies) is never a regular. Ranked by
-- shared threads, then by the partner's latest reply in them, then by DID;
-- at most six. Partners banned forum-wide, or shut out by a gate that is
-- closed now (no open membership window), are left out. The shared-thread
-- count orders the list here and never leaves this script.
local NS = "app.atmobb"

function handle()
  local actor = params.actor
  local forum = params.forum
  if not actor then
    error("missing required parameter: actor")
  end
  if not forum then
    error("missing required parameter: forum")
  end

  -- public_threads and the reply window are duplicated verbatim from
  -- getActorActivity.lua; keep in sync (thread-queries.integration.test.ts
  -- checks). The timestamps are index times, not the signer's createdAt.
  local rows = db.raw([[
    WITH public_threads AS (
      SELECT s.thread_uri, s.board_uri, s.author_did, s.title, s.created_at,
             s.reply_count, b.did AS forum_did,
             (b.record::jsonb)->>'name' AS board_name,
             (fp.record::jsonb)->>'name' AS forum_name
      FROM atmobb_thread_stats s
      JOIN happyview_records t
        ON t.uri = s.thread_uri AND t.collection = $3
      JOIN happyview_records b
        ON b.uri = s.board_uri AND b.collection = $2
      LEFT JOIN happyview_records fp
        ON fp.did = b.did AND fp.collection = $5 AND fp.rkey = 'self'
      WHERE NOT s.hidden
        AND (b.record::jsonb)->'access'->>'space' IS NULL
        AND b.did NOT IN (SELECT did FROM atmobb_delisted_forums)
        AND (NOT EXISTS (
            SELECT 1 FROM atmobb_forum_gating g
            WHERE g.forum_did = split_part(s.board_uri, '/', 3)
              AND g.gated_since <= s.created_at
              AND (g.opened_at IS NULL OR s.created_at < g.opened_at))
          OR s.author_did = split_part(s.board_uri, '/', 3)
          OR EXISTS (
            SELECT 1 FROM atmobb_member_windows w
            WHERE w.forum_did = split_part(s.board_uri, '/', 3)
              AND w.did = s.author_did
              AND w.since <= s.created_at
              AND (w.until IS NULL OR s.created_at < w.until)))
    ),
    recent_replies AS (
      SELECT r.did, t.thread_uri, r.created_at::timestamptz AS replied_at
      FROM happyview_records r
      JOIN public_threads t
        ON t.thread_uri = (r.record::jsonb)->'thread'->>'uri'
      WHERE r.collection = $4 AND t.forum_did = $6
        AND r.created_at::timestamptz > now() - interval '180 days'
        AND NOT EXISTS (
          SELECT 1 FROM atmobb_bans bn
          WHERE bn.did = r.did AND bn.forum_did = $6
            AND (bn.board_uri IS NULL OR bn.board_uri = t.board_uri)
            AND r.created_at > bn.since
            AND (bn.until IS NULL OR r.created_at < bn.until))
        AND (NOT EXISTS (
            SELECT 1 FROM atmobb_forum_gating g
            WHERE g.forum_did = split_part(t.board_uri, '/', 3)
              AND g.gated_since <= r.created_at
              AND (g.opened_at IS NULL OR r.created_at < g.opened_at))
          OR r.did = split_part(t.board_uri, '/', 3)
          OR EXISTS (
            SELECT 1 FROM atmobb_member_windows w
            WHERE w.forum_did = split_part(t.board_uri, '/', 3)
              AND w.did = r.did
              AND w.since <= r.created_at
              AND (w.until IS NULL OR r.created_at < w.until)))
    ),
    partners AS (
      SELECT p.did, COUNT(DISTINCT p.thread_uri)::int AS shared_threads,
             MAX(p.replied_at) AS last_shared
      FROM recent_replies p
      WHERE p.did <> $1
        AND p.thread_uri IN (SELECT thread_uri FROM recent_replies WHERE did = $1)
      GROUP BY p.did
    )
    SELECT p.did, p.shared_threads, ap.record AS profile
    FROM partners p
    LEFT JOIN happyview_records ap
      ON ap.did = p.did AND ap.collection = $7 AND ap.rkey = 'self'
    WHERE p.shared_threads >= 2
      AND NOT EXISTS (
        SELECT 1 FROM atmobb_bans bn
        WHERE bn.did = p.did AND bn.forum_did = $6 AND bn.board_uri IS NULL
          AND (bn.until IS NULL OR bn.until::timestamptz > now()))
      AND (NOT EXISTS (
          SELECT 1 FROM atmobb_forum_gating g
          WHERE g.forum_did = $6 AND g.opened_at IS NULL)
        OR p.did = $6
        OR EXISTS (
          SELECT 1 FROM atmobb_member_windows mw
          WHERE mw.forum_did = $6 AND mw.did = p.did AND mw.until IS NULL))
    ORDER BY p.shared_threads DESC, p.last_shared DESC, p.did ASC
    LIMIT 6
  ]], { actor, NS .. ".forum.board", NS .. ".discussion.thread",
        NS .. ".discussion.reply", NS .. ".forum.profile", forum,
        NS .. ".actor.profile" })

  local regulars = toarray({})
  for i, row in ipairs(rows) do
    local profile = nil
    if row.profile then profile = json.decode(row.profile) end
    regulars[i] = { did = row.did, profile = profile }
  end
  return { regulars = regulars }
end
