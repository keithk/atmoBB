-- record.create:app.atmobb.discussion.thread
-- Maintain atmobb_thread_stats and per-forum post counts on thread creation.
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
  end
  return record
end
