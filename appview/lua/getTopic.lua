-- xrpc.query:app.atmobb.forum.getTopic
-- Everything currently sharing a topic: boards, their forums, their sizes.
-- The admin panel's "what would we be federating into" preview.
local NS = "app.atmobb"

function handle()
  local topic = params.topic
  if not topic then
    error("missing required parameter: topic")
  end

  local rows = db.raw([[
    SELECT b.uri, b.did, b.record,
           (fp.record::jsonb)->>'name' AS forum_name,
           COALESCE(s.thread_count, 0) AS thread_count,
           COALESCE(s.reply_count, 0) AS reply_count,
           s.latest_activity
    FROM happyview_records b
    LEFT JOIN happyview_records fp
      ON fp.did = b.did AND fp.collection = $2 AND fp.rkey = 'self'
    LEFT JOIN (
      SELECT board_uri,
             COUNT(*)::int AS thread_count,
             SUM(reply_count)::int AS reply_count,
             MAX(last_activity) AS latest_activity
      FROM atmobb_thread_stats WHERE NOT hidden GROUP BY board_uri
    ) s ON s.board_uri = b.uri
    WHERE b.collection = $3 AND (b.record::jsonb)->>'topic' = $1
      AND b.did NOT IN (SELECT did FROM atmobb_delisted_forums)
    ORDER BY s.latest_activity DESC NULLS LAST
  ]], { topic, NS .. ".forum.profile", NS .. ".forum.board" })

  local boards = toarray({})
  local forums = {}
  local threads = 0
  local posts = 0
  for i, row in ipairs(rows) do
    local value = json.decode(row.record)
    forums[row.did] = true
    threads = threads + row.thread_count
    posts = posts + row.thread_count + row.reply_count
    boards[i] = {
      uri = row.uri,
      name = value.name,
      description = value.description,
      federation = value.topicFederation or "open",
      forum = { did = row.did, name = row.forum_name },
      threadCount = row.thread_count,
      replyCount = row.reply_count,
      latestActivity = row.latest_activity,
    }
  end

  local forum_count = 0
  for _ in pairs(forums) do forum_count = forum_count + 1 end

  return {
    topic = topic,
    totals = { boards = #rows, forums = forum_count, threads = threads, posts = posts },
    boards = boards,
  }
end
