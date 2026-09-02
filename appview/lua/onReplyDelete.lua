-- record.delete:app.atmobb.discussion.reply
-- Reverse onReplyCreate: one fewer reply, last activity recomputed from the
-- replies that remain, and the author's postcount for the thread's forum
-- given back. The record is still indexed when this runs, so it tells us
-- which thread it belonged to.
local NS = "app.atmobb"

function handle()
  local rows = db.raw([[
    SELECT record FROM happyview_records WHERE uri = $1
  ]], { uri })
  if not rows[1] then return true end
  local reply = json.decode(rows[1].record)
  local thread = reply.thread and reply.thread.uri
  if not thread then return true end

  db.raw([[
    UPDATE atmobb_post_counts SET posts = GREATEST(posts - 1, 0)
    WHERE did = $2 AND forum_did = (
      SELECT split_part(board_uri, '/', 3) FROM atmobb_thread_stats WHERE thread_uri = $1
    )
  ]], { thread, did })
  db.raw([[
    UPDATE atmobb_thread_stats s
    SET reply_count = GREATEST(s.reply_count - 1, 0),
        last_activity = GREATEST(s.created_at, COALESCE(rest.last::text, s.created_at)),
        last_reply_did = rest.last_did
    FROM (
      SELECT max(p.created_at) AS last,
             (array_agg(p.did ORDER BY p.created_at DESC))[1] AS last_did
      FROM happyview_record_refs r
      JOIN happyview_records p ON p.uri = r.source_uri AND p.collection = $3
      WHERE r.target_uri = $1 AND p.uri <> $2
    ) rest
    WHERE s.thread_uri = $1
  ]], { thread, uri, NS .. ".discussion.reply" })
  return true
end
