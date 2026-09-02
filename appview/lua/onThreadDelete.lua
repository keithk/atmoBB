-- record.delete:app.atmobb.discussion.thread
-- Drop the thread's stats row and give back the post counts it earned. This
-- runs before the engine removes the record, so the reply backlinks are still
-- there to count: replies stay in their authors' repos but no longer list
-- anywhere, so they stop counting toward this forum too.
local NS = "app.atmobb"

function handle()
  local rows = db.raw([[
    SELECT board_uri FROM atmobb_thread_stats WHERE thread_uri = $1
  ]], { uri })
  local board = rows[1] and rows[1].board_uri
  if board then
    local forum = string.match(board, "^at://([^/]+)/")
    db.raw([[DELETE FROM atmobb_thread_stats WHERE thread_uri = $1]], { uri })
    db.raw([[
      UPDATE atmobb_post_counts SET posts = GREATEST(posts - 1, 0)
      WHERE forum_did = $1 AND did = $2
    ]], { forum, did })
    db.raw([[
      UPDATE atmobb_post_counts pc
      SET posts = GREATEST(pc.posts - c.n, 0)
      FROM (
        SELECT p.did, count(*)::int AS n
        FROM happyview_record_refs r
        JOIN happyview_records p ON p.uri = r.source_uri AND p.collection = $3
        WHERE r.target_uri = $1
        GROUP BY p.did
      ) c
      WHERE pc.forum_did = $2 AND pc.did = c.did
    ]], { uri, forum, NS .. ".discussion.reply" })
  end
  return true
end
