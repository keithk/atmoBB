-- record.create:app.atmobb.discussion.reply
-- Bump thread stats and the author's postcount for the thread's forum, and
-- record the author's first served post on the board and the forum.
local NS = "app.atmobb"

function handle()
  if record and record.thread and record.thread.uri then
    db.raw([[
      UPDATE atmobb_thread_stats
      SET reply_count = reply_count + 1,
          last_activity = GREATEST(last_activity, $2),
          last_reply_did = $3
      WHERE thread_uri = $1
    ]], { record.thread.uri, record.createdAt or "", did })
    db.raw([[
      INSERT INTO atmobb_post_counts (forum_did, did, posts)
      SELECT split_part(board_uri, '/', 3), $2, 1
      FROM atmobb_thread_stats
      WHERE thread_uri = $1
      ON CONFLICT (forum_did, did)
      DO UPDATE SET posts = atmobb_post_counts.posts + 1
    ]], { record.thread.uri, did })
    -- First-seen rows as in onThreadCreate, with the board resolved through
    -- the thread's stats row. Kept for good once written.
    db.raw([[
      INSERT INTO atmobb_firsts (forum_did, did, board_uri, first_at, source_uri)
      SELECT b.did, $3::text, l.board_uri, $4::text, $1::text
      FROM atmobb_thread_stats s
      JOIN happyview_records b
        ON b.uri = s.board_uri AND b.collection = $5::text
      CROSS JOIN LATERAL (VALUES (b.uri), (NULL::text)) AS l(board_uri)
      WHERE s.thread_uri = $2::text
        AND (b.record::jsonb)->'access'->>'space' IS NULL
        AND b.did NOT IN (SELECT did FROM atmobb_delisted_forums)
        AND (NOT EXISTS (
            SELECT 1 FROM atmobb_forum_gating g
            WHERE g.forum_did = b.did
              AND g.gated_since <= $4::text
              AND (g.opened_at IS NULL OR $4::text < g.opened_at))
          OR $3::text = b.did
          OR EXISTS (
            SELECT 1 FROM atmobb_member_windows w
            WHERE w.forum_did = b.did
              AND w.did = $3::text
              AND w.since <= $4::text
              AND (w.until IS NULL OR $4::text < w.until)))
      ON CONFLICT (forum_did, did, board_uri) DO NOTHING
    ]], { uri, record.thread.uri, did, record.createdAt or "", NS .. ".forum.board" })
  end
  return record
end
