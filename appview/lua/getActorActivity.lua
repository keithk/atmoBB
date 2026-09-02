-- xrpc.query:app.atmobb.actor.getActivity
-- One actor's exact public participation: local to the requested forum,
-- network-wide, broken down by origin forum, plus their recent public topics.
-- Permissioned boards and origin-hidden threads are excluded at the source.
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
    ),
    contributions AS (
      SELECT t.forum_did, t.forum_name, t.created_at AS posted_at,
             1 AS topics, 0 AS replies
      FROM public_threads t
      WHERE t.author_did = $1
      UNION ALL
      SELECT t.forum_did, t.forum_name,
             COALESCE((r.record::jsonb)->>'createdAt', r.created_at::text) AS posted_at,
             0 AS topics, 1 AS replies
      FROM happyview_records r
      JOIN public_threads t
        ON t.thread_uri = (r.record::jsonb)->'thread'->>'uri'
      WHERE r.collection = $4 AND r.did = $1
    )
    SELECT forum_did, MAX(forum_name) AS forum_name,
           COUNT(*)::int AS posts,
           SUM(topics)::int AS topics,
           SUM(replies)::int AS replies,
           MAX(posted_at) AS last_active
    FROM contributions
    GROUP BY forum_did
    ORDER BY posts DESC, forum_did ASC
  ]], { actor, NS .. ".forum.board", NS .. ".discussion.thread",
        NS .. ".discussion.reply", NS .. ".forum.profile" })

  local local_stats = { posts = 0, topics = 0, replies = 0 }
  local global_stats = { posts = 0, topics = 0, replies = 0, forums = #rows }
  local forums = toarray({})
  for i, row in ipairs(rows) do
    forums[i] = {
      did = row.forum_did,
      name = row.forum_name,
      posts = row.posts,
      topics = row.topics,
      replies = row.replies,
      lastActive = row.last_active,
    }
    global_stats.posts = global_stats.posts + row.posts
    global_stats.topics = global_stats.topics + row.topics
    global_stats.replies = global_stats.replies + row.replies
    if global_stats.lastActive == nil or row.last_active > global_stats.lastActive then
      global_stats.lastActive = row.last_active
    end
    if row.forum_did == forum then
      local_stats.posts = row.posts
      local_stats.topics = row.topics
      local_stats.replies = row.replies
      local_stats.lastActive = row.last_active
    end
  end

  local recent_rows = db.raw([[
    SELECT s.thread_uri, s.board_uri, s.title, s.created_at, s.reply_count,
           b.did AS forum_did,
           (b.record::jsonb)->>'name' AS board_name,
           (fp.record::jsonb)->>'name' AS forum_name
    FROM atmobb_thread_stats s
    JOIN happyview_records t
      ON t.uri = s.thread_uri AND t.collection = $3
    JOIN happyview_records b
      ON b.uri = s.board_uri AND b.collection = $2
    LEFT JOIN happyview_records fp
      ON fp.did = b.did AND fp.collection = $4 AND fp.rkey = 'self'
    WHERE s.author_did = $1 AND NOT s.hidden
      AND (b.record::jsonb)->'access'->>'space' IS NULL
      AND b.did NOT IN (SELECT did FROM atmobb_delisted_forums)
    ORDER BY s.created_at DESC
    LIMIT 6
  ]], { actor, NS .. ".forum.board", NS .. ".discussion.thread",
        NS .. ".forum.profile" })

  local recent = toarray({})
  for i, row in ipairs(recent_rows) do
    recent[i] = {
      uri = row.thread_uri,
      board = row.board_uri,
      boardName = row.board_name,
      title = row.title,
      createdAt = row.created_at,
      replyCount = row.reply_count,
      forum = { did = row.forum_did, name = row.forum_name },
    }
  end

  return {
    ["local"] = local_stats,
    global = global_stats,
    forums = forums,
    recentThreads = recent,
  }
end
