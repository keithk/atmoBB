-- xrpc.query:app.atmobb.discussion.getLatestThreads
-- Most recently active threads. With a forum param, scoped to that forum's
-- own boards plus the merged streams of its topic boards (federation dial
-- and the forum's moderation window applied); without one, the whole index.
-- Offset cursor.
local NS = "app.atmobb"

function handle()
  local limit = tonumber(params.limit) or 25
  if limit > 100 then limit = 100 end
  local offset = tonumber(params.cursor) or 0
  local forum = params.forum

  local scope_prefix = "%"
  local scope_forum = ""
  if forum then
    scope_prefix = "at://" .. forum .. "/%"
    scope_forum = forum
  end

  -- Blocks apply forum-wide in this feed (board-scoped blocks are honored
  -- on the board pages; the latest feed treats any block as a mute).
  local rows = db.raw([[
    WITH mine AS (
      SELECT uri, did, record::jsonb AS r FROM happyview_records
      WHERE collection = $4 AND did = $7 AND (record::jsonb)->>'topic' IS NOT NULL
    ),
    peers AS (
      SELECT DISTINCT b.uri FROM happyview_records b, mine
      WHERE b.collection = $4
        AND (b.record::jsonb)->>'topic' = mine.r->>'topic'
        AND (COALESCE(mine.r->>'topicFederation', 'open') = 'open'
             OR b.did = mine.did
             OR COALESCE(mine.r->'topicAllow', '[]'::jsonb) @> to_jsonb(b.did::text))
        AND (b.did = mine.did OR b.did NOT IN (SELECT did FROM atmobb_delisted_forums))
    )
    SELECT s.thread_uri, s.board_uri, s.author_did, s.title, s.created_at,
           s.reply_count, s.last_activity, s.last_reply_did,
           (b.record::jsonb)->>'name' AS board_name,
           (opf.record::jsonb)->>'name' AS origin_forum_name,
           ap.record AS author_profile
    FROM atmobb_thread_stats s
    LEFT JOIN happyview_records b ON b.uri = s.board_uri
    LEFT JOIN happyview_records opf
      ON opf.did = split_part(s.board_uri, '/', 3) AND opf.collection = $5 AND opf.rkey = 'self'
    LEFT JOIN happyview_records ap
      ON ap.did = s.author_did AND ap.collection = $1 AND ap.rkey = 'self'
    WHERE NOT s.hidden
      -- Members-only boards never surface in the public feed: their real
      -- threads live in the permissioned space, so anything here is a leak/stale.
      AND (b.record::jsonb)->'access'->>'space' IS NULL
      AND (s.board_uri LIKE $6 OR s.board_uri IN (SELECT uri FROM peers))
      AND NOT COALESCE((
        SELECT (a.record::jsonb)->>'action' FROM happyview_records a
        WHERE a.collection = $8 AND a.did = $7
          AND (a.record::jsonb)->'subject'->>'uri' = s.thread_uri
          AND (a.record::jsonb)->>'action' IN ('hide','unhide')
        ORDER BY a.created_at DESC LIMIT 1
      ) = 'hide', false)
      AND NOT COALESCE((
        SELECT (a.record::jsonb)->>'action' FROM happyview_records a
        WHERE a.collection = $8 AND a.did = $7
          AND (a.record::jsonb)->'subject'->>'did' = split_part(s.board_uri, '/', 3)
          AND (a.record::jsonb)->>'action' IN ('block','unblock')
        ORDER BY a.created_at DESC LIMIT 1
      ) = 'block', false)
    AND NOT EXISTS (
      SELECT 1 FROM atmobb_bans bn
      WHERE bn.did = s.author_did
        AND bn.forum_did IN (split_part(s.board_uri, '/', 3), $7)
        AND (bn.board_uri IS NULL OR bn.board_uri = s.board_uri)
        AND s.created_at > bn.since
        AND (bn.until IS NULL OR s.created_at < bn.until))
    ORDER BY s.last_activity DESC
    LIMIT $2 OFFSET $3
  ]], { NS .. ".actor.profile", limit, offset, NS .. ".forum.board",
        NS .. ".forum.profile", scope_prefix, scope_forum,
        NS .. ".moderation.action" })

  local threads = toarray({})
  for i, row in ipairs(rows) do
    local profile = nil
    if row.author_profile then profile = json.decode(row.author_profile) end
    local origin = nil
    local origin_did = string.match(row.board_uri, "^at://([^/]+)/")
    if forum and origin_did and origin_did ~= forum then
      origin = { did = origin_did, name = row.origin_forum_name }
    end
    threads[i] = {
      uri = row.thread_uri,
      board = row.board_uri,
      boardName = row.board_name,
      author = row.author_did,
      authorProfile = profile,
      title = row.title,
      createdAt = row.created_at,
      replyCount = row.reply_count,
      lastActivity = row.last_activity,
      lastReplyBy = row.last_reply_did,
      origin = origin,
    }
  end

  local result = { threads = threads }
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
