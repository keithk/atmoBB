-- record.create:app.atmobb.discussion.reply
-- Bump thread stats and the author's postcount for the thread's forum.
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
  end
  return record
end
