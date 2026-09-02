-- xrpc.query:app.atmobb.discussion.getBoardThreads
-- Threads in a board. A board with a topic returns the merged stream of
-- every peer board sharing the topic (federation dial applied), filtered
-- through the board's forum's moderation window: origin hides propagate
-- (the hidden flag), and the viewing forum's own hide/block actions apply.
-- A plain board returns just its own threads. A board's own pinned threads
-- sort first; a peer's pins only count on the peer's board. Offset cursor.
local NS = "app.atmobb"

function handle()
  local board = params.board
  if not board then
    error("missing required parameter: board")
  end
  local limit = tonumber(params.limit) or 25
  if limit > 100 then limit = 100 end
  local offset = tonumber(params.cursor) or 0
  local my_did = string.match(board, "^at://([^/]+)/")

  local board_record = db.get(board)

  -- peer boards: self plus same-topic boards the dial admits
  local peers_cte = [[
    WITH me AS (
      SELECT uri, did, record::jsonb AS r FROM happyview_records WHERE uri = $1
    ),
    peers AS (
      SELECT b.uri FROM happyview_records b, me
      WHERE b.collection = $2
        AND me.r->>'topic' IS NOT NULL
        AND (b.record::jsonb)->>'topic' = me.r->>'topic'
        AND (COALESCE(me.r->>'topicFederation', 'open') = 'open'
             OR b.did = me.did
             OR COALESCE(me.r->'topicAllow', '[]'::jsonb) @> to_jsonb(b.did::text))
        AND (b.did = me.did OR b.did NOT IN (SELECT did FROM atmobb_delisted_forums))
      UNION
      SELECT uri FROM me
    )
  ]]

  -- the viewing forum's window: origin hides (s.hidden), then this forum's
  -- own thread hides and forum blocks, latest action winning
  local window = [[
    NOT s.hidden
    AND NOT COALESCE((
      SELECT (a.record::jsonb)->>'action' FROM happyview_records a
      WHERE a.collection = $3 AND a.did = $4
        AND (a.record::jsonb)->'subject'->>'uri' = s.thread_uri
        AND (a.record::jsonb)->>'action' IN ('hide','unhide')
      ORDER BY a.created_at DESC LIMIT 1
    ) = 'hide', false)
    AND NOT COALESCE((
      SELECT (a.record::jsonb)->>'action' FROM happyview_records a
      WHERE a.collection = $3 AND a.did = $4
        AND (a.record::jsonb)->'subject'->>'did' = split_part(s.board_uri, '/', 3)
        AND (a.record::jsonb)->>'action' IN ('block','unblock')
        AND COALESCE((a.record::jsonb)->>'board', $1) = $1
      ORDER BY a.created_at DESC LIMIT 1
    ) = 'block', false)
    AND NOT EXISTS (
      SELECT 1 FROM atmobb_bans bn
      WHERE bn.did = s.author_did
        AND bn.forum_did IN (split_part(s.board_uri, '/', 3), $4)
        AND (bn.board_uri IS NULL OR bn.board_uri = s.board_uri)
        AND s.created_at > bn.since
        AND (bn.until IS NULL OR s.created_at < bn.until))
  ]]

  local totals = db.raw(peers_cte .. [[
    SELECT COUNT(*)::int AS thread_count, COALESCE(SUM(s.reply_count), 0)::int AS reply_count
    FROM atmobb_thread_stats s
    JOIN peers p ON s.board_uri = p.uri
    WHERE ]] .. window,
    { board, NS .. ".forum.board", NS .. ".moderation.action", my_did })
  if board_record then
    local t = totals[1] or {}
    board_record.threadCount = t.thread_count or 0
    board_record.replyCount = t.reply_count or 0
  end

  local rows = db.raw(peers_cte .. [[
    SELECT s.thread_uri, s.author_did, s.title, s.created_at,
           s.reply_count, s.last_activity, s.last_reply_did, s.board_uri,
           s.locked, (s.pinned AND s.board_uri = $1) AS pinned,
           tr.cid AS thread_cid,
           (opf.record::jsonb)->>'name' AS origin_forum_name,
           ap.record AS author_profile
    FROM atmobb_thread_stats s
    JOIN peers p ON s.board_uri = p.uri
    LEFT JOIN happyview_records tr ON tr.uri = s.thread_uri
    LEFT JOIN happyview_records opf
      ON opf.did = split_part(s.board_uri, '/', 3) AND opf.collection = $7 AND opf.rkey = 'self'
    LEFT JOIN happyview_records ap
      ON ap.did = s.author_did AND ap.collection = $8 AND ap.rkey = 'self'
    WHERE ]] .. window .. [[
    ORDER BY (s.pinned AND s.board_uri = $1) DESC, s.last_activity DESC
    LIMIT $5 OFFSET $6
  ]], { board, NS .. ".forum.board", NS .. ".moderation.action", my_did,
        limit, offset, NS .. ".forum.profile", NS .. ".actor.profile" })

  local threads = toarray({})
  for i, row in ipairs(rows) do
    local profile = nil
    if row.author_profile then profile = json.decode(row.author_profile) end
    local origin = nil
    local origin_did = string.match(row.board_uri, "^at://([^/]+)/")
    if origin_did and origin_did ~= my_did then
      origin = { did = origin_did, name = row.origin_forum_name }
    end
    threads[i] = {
      uri = row.thread_uri,
      cid = row.thread_cid,
      author = row.author_did,
      authorProfile = profile,
      title = row.title,
      createdAt = row.created_at,
      replyCount = row.reply_count,
      lastActivity = row.last_activity,
      lastReplyBy = row.last_reply_did,
      board = row.board_uri,
      origin = origin,
      locked = row.locked or false,
      pinned = row.pinned or false,
    }
  end

  local result = { board = board_record, threads = threads }
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
