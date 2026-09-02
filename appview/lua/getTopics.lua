-- xrpc.query:app.atmobb.forum.getTopics
-- Every topic carried by any board in the atmosphere, with sizes, most
-- recently active first. Discovery for admins choosing a topic to join.
local NS = "app.atmobb"

function handle()
  local rows = db.raw([[
    SELECT (b.record::jsonb)->>'topic' AS topic,
           COUNT(*)::int AS boards,
           COUNT(DISTINCT b.did)::int AS forums,
           COALESCE(SUM(s.thread_count), 0)::int AS threads,
           COALESCE(SUM(s.thread_count + s.reply_count), 0)::int AS posts,
           MAX(s.latest_activity) AS latest_activity
    FROM happyview_records b
    LEFT JOIN (
      SELECT board_uri,
             COUNT(*)::int AS thread_count,
             COALESCE(SUM(reply_count), 0)::int AS reply_count,
             MAX(last_activity) AS latest_activity
      FROM atmobb_thread_stats WHERE NOT hidden GROUP BY board_uri
    ) s ON s.board_uri = b.uri
    WHERE b.collection = $1 AND (b.record::jsonb)->>'topic' IS NOT NULL
      AND b.did NOT IN (SELECT did FROM atmobb_delisted_forums)
    GROUP BY (b.record::jsonb)->>'topic'
    ORDER BY MAX(s.latest_activity) DESC NULLS LAST
  ]], { NS .. ".forum.board" })

  local topics = toarray({})
  for i, row in ipairs(rows) do
    topics[i] = {
      topic = row.topic,
      boards = row.boards,
      forums = row.forums,
      threads = row.threads,
      posts = row.posts,
      latestActivity = row.latest_activity,
    }
  end

  return { topics = topics }
end
