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
  local query = params.q or ""
  local tag = params.tag or ""

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
        -- Space-backed boards are shells in the public index. Their threads
        -- must only come from the authenticated permissioned-space read path.
        AND (b.record::jsonb)->'access'->>'space' IS NULL
        AND (b.did = me.did OR b.did NOT IN (SELECT did FROM atmobb_delisted_forums))
      UNION
      SELECT uri FROM me WHERE r->'access'->>'space' IS NULL
    )
  ]]

  -- the viewing forum's window: origin hides (s.hidden), then this forum's
  -- own thread hides and forum blocks, latest action winning. Bans and
  -- membership are judged at the post's time: on a board whose owning forum
  -- was gated then, the author must have held an acceptance window covering
  -- that moment, unless the author is the forum itself.
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
    AND (NOT EXISTS (
        SELECT 1 FROM atmobb_forum_gating g
        WHERE g.forum_did = split_part(s.board_uri, '/', 3)
          AND g.gated_since <= s.created_at
          AND (g.opened_at IS NULL OR s.created_at < g.opened_at))
      OR s.author_did = split_part(s.board_uri, '/', 3)
      OR EXISTS (
        SELECT 1 FROM atmobb_member_windows w
        WHERE w.forum_did = split_part(s.board_uri, '/', 3)
          AND w.did = s.author_did
          AND w.since <= s.created_at
          AND (w.until IS NULL OR s.created_at < w.until)))
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

  local filtered_count = totals[1] and totals[1].thread_count or 0
  if query ~= "" or tag ~= "" then
    local filtered = db.raw(peers_cte .. [[
      SELECT COUNT(*)::int AS thread_count
      FROM atmobb_thread_stats s
      JOIN peers p ON s.board_uri = p.uri
      LEFT JOIN happyview_records tr ON tr.uri = s.thread_uri
      WHERE ]] .. window .. [[
        AND ($5 = '' OR strpos(lower(s.title), lower($5)) > 0)
        AND ($6 = '' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE((tr.record::jsonb)->'tags', '[]'::jsonb)) jt(value)
          WHERE lower(jt.value) = lower($6)))
    ]], { board, NS .. ".forum.board", NS .. ".moderation.action", my_did, query, tag })
    filtered_count = filtered[1] and filtered[1].thread_count or 0
  end

  local rows = db.raw(peers_cte .. [[
    SELECT s.thread_uri, s.author_did, s.title, s.created_at,
           s.reply_count, s.last_activity, s.last_reply_did, s.board_uri,
           s.locked, (s.pinned AND s.board_uri = $1) AS pinned,
           tr.cid AS thread_cid,
           ((tr.record::jsonb)->'tags')::text AS tags,
           (opf.record::jsonb)->>'name' AS origin_forum_name,
           ap.record AS author_profile,
           pa.participants
    FROM atmobb_thread_stats s
    JOIN peers p ON s.board_uri = p.uri
    LEFT JOIN happyview_records tr ON tr.uri = s.thread_uri
    LEFT JOIN happyview_records opf
      ON opf.did = split_part(s.board_uri, '/', 3) AND opf.collection = $7 AND opf.rkey = 'self'
    LEFT JOIN happyview_records ap
      ON ap.did = s.author_did AND ap.collection = $8 AND ap.rkey = 'self'
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('did', picked.did, 'profile', picked.profile)
                       ORDER BY picked.priority, picked.last_at DESC, picked.did)::text AS participants
      FROM (
        SELECT did, profile, priority, last_at
        FROM (
          SELECT DISTINCT ON (did) did, profile, priority, last_at
          FROM (
            SELECT s.author_did AS did, ap.record::jsonb AS profile,
                   0 AS priority, s.created_at AS last_at
            UNION ALL
            SELECT rp.did, rap.record::jsonb, 1, rp.created_at
            FROM happyview_record_refs rr
            JOIN happyview_records rp ON rp.uri = rr.source_uri AND rp.collection = $11
            LEFT JOIN happyview_records rap
              ON rap.did = rp.did AND rap.collection = $8 AND rap.rkey = 'self'
            WHERE rr.target_uri = s.thread_uri
              AND (NOT s.locked OR s.locked_at IS NULL OR rp.created_at <= s.locked_at OR EXISTS (
                SELECT 1 FROM happyview_records m
                WHERE m.collection = $12 AND m.did = $4
                  AND (m.record::jsonb)->>'subject' = rp.did))
              AND NOT EXISTS (
                SELECT 1 FROM atmobb_bans bn
                WHERE bn.did = rp.did
                  AND bn.forum_did IN (split_part(s.board_uri, '/', 3), $4)
                  AND (bn.board_uri IS NULL OR bn.board_uri = s.board_uri)
                  AND rp.created_at > bn.since
                  AND (bn.until IS NULL OR rp.created_at < bn.until))
              AND (NOT EXISTS (
                  SELECT 1 FROM atmobb_forum_gating g
                  WHERE g.forum_did = split_part(s.board_uri, '/', 3)
                    AND g.gated_since <= rp.created_at
                    AND (g.opened_at IS NULL OR rp.created_at < g.opened_at))
                OR rp.did = split_part(s.board_uri, '/', 3)
                OR EXISTS (
                  SELECT 1 FROM atmobb_member_windows w
                  WHERE w.forum_did = split_part(s.board_uri, '/', 3)
                    AND w.did = rp.did
                    AND w.since <= rp.created_at
                    AND (w.until IS NULL OR rp.created_at < w.until)))
          ) candidates
          ORDER BY did, priority, last_at DESC
        ) deduped
        ORDER BY priority, last_at DESC, did
        LIMIT 5
      ) picked
    ) pa ON true
    WHERE ]] .. window .. [[
    AND ($9 = '' OR strpos(lower(s.title), lower($9)) > 0)
    AND ($10 = '' OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE((tr.record::jsonb)->'tags', '[]'::jsonb)) jt(value)
      WHERE lower(jt.value) = lower($10)))
    ORDER BY (s.pinned AND s.board_uri = $1) DESC, s.last_activity DESC
    LIMIT $5 OFFSET $6
  ]], { board, NS .. ".forum.board", NS .. ".moderation.action", my_did,
        limit, offset, NS .. ".forum.profile", NS .. ".actor.profile",
        query, tag, NS .. ".discussion.reply", NS .. ".forum.moderator" })

  local threads = toarray({})
  for i, row in ipairs(rows) do
    local profile = nil
    if row.author_profile then profile = json.decode(row.author_profile) end
    local tags = toarray({})
    if row.tags then tags = type(row.tags) == "string" and json.decode(row.tags) or row.tags end
    local participants = toarray({})
    if row.participants then
      participants = type(row.participants) == "string" and json.decode(row.participants) or row.participants
    end
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
      tags = tags,
      createdAt = row.created_at,
      replyCount = row.reply_count,
      lastActivity = row.last_activity,
      lastReplyBy = row.last_reply_did,
      participants = participants,
      board = row.board_uri,
      origin = origin,
      locked = row.locked or false,
      pinned = row.pinned or false,
    }
  end

  local result = { board = board_record, threads = threads, filteredCount = filtered_count }
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
