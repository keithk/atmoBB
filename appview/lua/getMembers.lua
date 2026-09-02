-- xrpc.query:app.atmobb.forum.getMembers
-- Members of one forum by postcount, with profiles. Membership records are
-- scoped to the forum; posts and activity are scoped to its own boards.
-- Offset cursor.
local NS = "app.atmobb"

function handle()
  local forum = params.forum
  if not forum then
    error("missing required parameter: forum")
  end
  local limit = tonumber(params.limit) or 50
  if limit > 100 then limit = 100 end
  local offset = tonumber(params.cursor) or 0

  local rows = db.raw([[
    WITH members AS (
      SELECT did
      FROM happyview_records
      WHERE collection = $1 AND (record::jsonb)->>'forum' = $3
      GROUP BY did
    )
    SELECT m.did, COALESCE(pc.posts, 0) AS posts,
           COALESCE((SELECT SUM(pca.posts) FROM atmobb_post_counts pca
             WHERE pca.did = m.did), 0)::int AS total_posts,
           ap.record AS profile,
           (SELECT MAX(s.last_activity) FROM atmobb_thread_stats s
             WHERE s.board_uri LIKE $2
               AND (s.author_did = m.did OR s.last_reply_did = m.did)) AS last_active
    FROM members m
    LEFT JOIN atmobb_post_counts pc
      ON pc.forum_did = $3 AND pc.did = m.did
    LEFT JOIN happyview_records ap
      ON ap.did = m.did AND ap.collection = $4 AND ap.rkey = 'self'
    ORDER BY posts DESC, m.did ASC
    LIMIT $5 OFFSET $6
  ]], { NS .. ".forum.membership", "at://" .. forum .. "/%", forum,
        NS .. ".actor.profile", limit, offset })

  local members = toarray({})
  for i, row in ipairs(rows) do
    local profile = nil
    if row.profile then profile = json.decode(row.profile) end
    members[i] = {
      did = row.did,
      posts = row.posts,
      totalPosts = row.total_posts,
      profile = profile,
      lastActive = row.last_active,
    }
  end

  local result = { members = members }
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
