-- record.create:app.atmobb.discussion.thread
-- Maintain atmobb_thread_stats, per-forum post counts, and first-seen rows on
-- thread creation.
local NS = "app.atmobb"

function handle()
  if record and record.board then
    db.raw([[
      INSERT INTO atmobb_thread_stats
        (thread_uri, board_uri, author_did, title, created_at, reply_count, last_activity, last_reply_did)
      VALUES ($1, $2, $3, $4, $5, 0, $5, NULL)
      ON CONFLICT (thread_uri) DO NOTHING
    ]], { uri, record.board, did, record.title or "", record.createdAt or "" })
    local forum = string.match(record.board, "^at://([^/]+)/")
    if forum then
      db.raw([[
        INSERT INTO atmobb_post_counts (forum_did, did, posts) VALUES ($1, $2, 1)
        ON CONFLICT (forum_did, did)
        DO UPDATE SET posts = atmobb_post_counts.posts + 1
      ]], { forum, did })
    end
    -- The author's first served post on this board and on this forum, one row
    -- each, kept for good: a later delete or hide does not take a stamp back.
    -- Served is what getActorActivity serves (a board without a space on a
    -- forum that is not delisted, inside the author's membership window while
    -- gated); hidden state cannot be known yet. The forum-level row spells its
    -- NULL board in SQL because db.raw stops binding at the first nil. A post
    -- with no createdAt is placed at its index time, so the window test
    -- cannot be skipped by leaving the field out.
    db.raw([[
      INSERT INTO atmobb_firsts (forum_did, did, board_uri, first_at, source_uri)
      SELECT b.did, $3::text, l.board_uri, p.at, $1::text
      FROM happyview_records b
      CROSS JOIN LATERAL (VALUES (b.uri), (NULL::text)) AS l(board_uri)
      CROSS JOIN LATERAL (SELECT COALESCE(NULLIF($4::text, ''),
        (SELECT r.created_at::text FROM happyview_records r WHERE r.uri = $1::text),
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS at) p
      WHERE b.uri = $2::text AND b.collection = $5::text
        AND (b.record::jsonb)->'access'->>'space' IS NULL
        AND b.did NOT IN (SELECT did FROM atmobb_delisted_forums)
        AND (NOT EXISTS (
            SELECT 1 FROM atmobb_forum_gating g
            WHERE g.forum_did = b.did
              AND g.gated_since <= p.at
              AND (g.opened_at IS NULL OR p.at < g.opened_at))
          OR $3::text = b.did
          OR EXISTS (
            SELECT 1 FROM atmobb_member_windows w
            WHERE w.forum_did = b.did
              AND w.did = $3::text
              AND w.since <= p.at
              AND (w.until IS NULL OR p.at < w.until)))
      ON CONFLICT (forum_did, did, board_uri) DO NOTHING
    ]], { uri, record.board, did, record.createdAt or "", NS .. ".forum.board" })
  end
  return record
end
