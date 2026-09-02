-- xrpc.query:app.atmobb.forum.getBoardIndex
-- Board index for a forum: forum profile + boards with thread counts, latest
-- thread (title/author/time), and forum-wide totals for the stats card.
local NS = "app.atmobb"

function handle()
  local forum = params.forum
  if not forum then
    error("missing required parameter: forum")
  end

  local profile = db.get("at://" .. forum .. "/" .. NS .. ".forum.profile/self")

  local rows = db.raw([[
    SELECT b.uri, b.record, b.created_at,
           COALESCE(s.thread_count, 0) AS thread_count,
           COALESCE(s.reply_count, 0) AS reply_count,
           s.latest_activity,
           latest.title AS latest_title,
           latest.thread_uri AS latest_uri,
           latest.author_did AS latest_author,
           latest.last_reply_did AS latest_reply_author,
           ap.record AS latest_author_profile
    FROM happyview_records b
    LEFT JOIN (
      SELECT c.board_uri,
             COUNT(*)::int AS thread_count,
             SUM(c.reply_count)::int AS reply_count,
             MAX(c.last_activity) AS latest_activity
      FROM atmobb_thread_stats c WHERE NOT c.hidden
      AND NOT EXISTS (
        SELECT 1 FROM atmobb_bans bn
        WHERE bn.did = c.author_did
          AND bn.forum_did IN (split_part(c.board_uri, '/', 3), $1)
          AND (bn.board_uri IS NULL OR bn.board_uri = c.board_uri)
          AND c.created_at > bn.since
          AND (bn.until IS NULL OR c.created_at < bn.until))
      GROUP BY c.board_uri
    ) s ON s.board_uri = b.uri
    LEFT JOIN LATERAL (
      SELECT t.thread_uri, t.title, t.author_did, t.last_reply_did, t.last_activity
      FROM atmobb_thread_stats t
      WHERE t.board_uri = b.uri AND NOT t.hidden
      AND NOT EXISTS (
        SELECT 1 FROM atmobb_bans bn
        WHERE bn.did = t.author_did
          AND bn.forum_did IN (split_part(t.board_uri, '/', 3), $1)
          AND (bn.board_uri IS NULL OR bn.board_uri = t.board_uri)
          AND t.created_at > bn.since
          AND (bn.until IS NULL OR t.created_at < bn.until))
      ORDER BY t.last_activity DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN happyview_records ap
      ON ap.did = COALESCE(latest.last_reply_did, latest.author_did)
     AND ap.collection = $2 AND ap.rkey = 'self'
    WHERE b.collection = $3 AND b.did = $1
    ORDER BY COALESCE(((b.record::jsonb)->>'order')::int, 2147483647), b.created_at
  ]], { forum, NS .. ".actor.profile", NS .. ".forum.board" })

  local boards = toarray({})
  for i, row in ipairs(rows) do
    local latest = nil
    if row.latest_uri then
      local prof = nil
      if row.latest_author_profile then prof = json.decode(row.latest_author_profile) end
      latest = {
        uri = row.latest_uri,
        title = row.latest_title,
        author = row.latest_reply_author or row.latest_author,
        authorProfile = prof,
        at = row.latest_activity,
      }
    end
    boards[i] = {
      uri = row.uri,
      value = json.decode(row.record),
      threadCount = row.thread_count,
      replyCount = row.reply_count,
      latestActivity = row.latest_activity,
      latest = latest,
    }
  end

  -- Topic boards: their counts and latest merge every peer board sharing
  -- the topic (federation dial applied), minus origin-hidden threads and
  -- forums this forum has blocked. Overrides the local numbers in `boards`.
  local topic_rows = db.raw([[
    SELECT b.uri,
           COALESCE(agg.thread_count, 0) AS thread_count,
           COALESCE(agg.reply_count, 0) AS reply_count,
           agg.latest_activity,
           latest.thread_uri AS latest_uri,
           latest.title AS latest_title,
           latest.author_did AS latest_author,
           latest.last_reply_did AS latest_reply_author,
           latest.board_uri AS latest_board,
           (opf.record::jsonb)->>'name' AS latest_origin_name,
           ap.record AS latest_author_profile
    FROM happyview_records b
    JOIN LATERAL (
      SELECT array_agg(p.uri) AS uris
      FROM happyview_records p
      WHERE p.collection = $2
        AND (p.record::jsonb)->>'topic' = (b.record::jsonb)->>'topic'
        AND (COALESCE((b.record::jsonb)->>'topicFederation', 'open') = 'open'
             OR p.did = b.did
             OR COALESCE((b.record::jsonb)->'topicAllow', '[]'::jsonb) @> to_jsonb(p.did::text))
    ) peers ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS thread_count,
             COALESCE(SUM(s.reply_count), 0)::int AS reply_count,
             MAX(s.last_activity) AS latest_activity
      FROM atmobb_thread_stats s
      WHERE s.board_uri = ANY(peers.uris) AND NOT s.hidden
        AND NOT COALESCE((
          SELECT (a.record::jsonb)->>'action' FROM happyview_records a
          WHERE a.collection = $4 AND a.did = $1
            AND (a.record::jsonb)->'subject'->>'did' = split_part(s.board_uri, '/', 3)
            AND (a.record::jsonb)->>'action' IN ('block','unblock')
            AND COALESCE((a.record::jsonb)->>'board', b.uri) = b.uri
          ORDER BY a.created_at DESC LIMIT 1
        ) = 'block', false)
        AND NOT EXISTS (
          SELECT 1 FROM atmobb_bans bn
          WHERE bn.did = s.author_did
            AND bn.forum_did IN (split_part(s.board_uri, '/', 3), $1)
            AND (bn.board_uri IS NULL OR bn.board_uri = s.board_uri)
            AND s.created_at > bn.since
            AND (bn.until IS NULL OR s.created_at < bn.until))
    ) agg ON true
    LEFT JOIN LATERAL (
      SELECT s.thread_uri, s.title, s.author_did, s.last_reply_did, s.board_uri, s.last_activity
      FROM atmobb_thread_stats s
      WHERE s.board_uri = ANY(peers.uris) AND NOT s.hidden
        AND NOT COALESCE((
          SELECT (a.record::jsonb)->>'action' FROM happyview_records a
          WHERE a.collection = $4 AND a.did = $1
            AND (a.record::jsonb)->'subject'->>'did' = split_part(s.board_uri, '/', 3)
            AND (a.record::jsonb)->>'action' IN ('block','unblock')
            AND COALESCE((a.record::jsonb)->>'board', b.uri) = b.uri
          ORDER BY a.created_at DESC LIMIT 1
        ) = 'block', false)
        AND NOT EXISTS (
          SELECT 1 FROM atmobb_bans bn
          WHERE bn.did = s.author_did
            AND bn.forum_did IN (split_part(s.board_uri, '/', 3), $1)
            AND (bn.board_uri IS NULL OR bn.board_uri = s.board_uri)
            AND s.created_at > bn.since
            AND (bn.until IS NULL OR s.created_at < bn.until))
      ORDER BY s.last_activity DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN happyview_records opf
      ON opf.did = split_part(latest.board_uri, '/', 3) AND opf.collection = $3 AND opf.rkey = 'self'
    LEFT JOIN happyview_records ap
      ON ap.did = COALESCE(latest.last_reply_did, latest.author_did)
     AND ap.collection = $5 AND ap.rkey = 'self'
    WHERE b.collection = $2 AND b.did = $1 AND (b.record::jsonb)->>'topic' IS NOT NULL
  ]], { forum, NS .. ".forum.board", NS .. ".forum.profile",
        NS .. ".moderation.action", NS .. ".actor.profile" })

  local topic_by_uri = {}
  for _, row in ipairs(topic_rows) do
    local latest = nil
    if row.latest_uri then
      local prof = nil
      if row.latest_author_profile then prof = json.decode(row.latest_author_profile) end
      local origin = nil
      local origin_did = string.match(row.latest_board or "", "^at://([^/]+)/")
      if origin_did and origin_did ~= forum then
        origin = { did = origin_did, name = row.latest_origin_name }
      end
      latest = {
        uri = row.latest_uri,
        title = row.latest_title,
        author = row.latest_reply_author or row.latest_author,
        authorProfile = prof,
        at = row.latest_activity,
        origin = origin,
      }
    end
    topic_by_uri[row.uri] = {
      threadCount = row.thread_count,
      replyCount = row.reply_count,
      latestActivity = row.latest_activity,
      latest = latest,
    }
  end
  for _, b in ipairs(boards) do
    local merged = topic_by_uri[b.uri]
    if merged then
      b.threadCount = merged.threadCount
      b.replyCount = merged.replyCount
      b.latestActivity = merged.latestActivity
      b.latest = merged.latest
    end
  end

  -- Members-only boards never surface content on the public index: their real
  -- threads live in the permissioned space, so any public stats for them are a
  -- leak or stale. Zero them out. The board name/description/lock still show.
  for _, b in ipairs(boards) do
    if b.value.access ~= nil and b.value.access.space ~= nil then
      b.threadCount = 0
      b.replyCount = 0
      b.latestActivity = nil
      b.latest = nil
    end
  end

  local cat_rows = db.raw([[
    SELECT uri, record FROM happyview_records
    WHERE collection = $1 AND did = $2
    ORDER BY COALESCE(((record::jsonb)->>'order')::int, 2147483647), created_at
  ]], { NS .. ".forum.category", forum })
  local categories = toarray({})
  for i, row in ipairs(cat_rows) do
    categories[i] = { uri = row.uri, value = json.decode(row.record) }
  end

  -- Stats scope to this forum: its own boards' threads, and members counted
  -- from membership records (joining is an act of the member, in their repo).
  local totals = db.raw([[
    SELECT (SELECT COUNT(*)::int FROM atmobb_thread_stats c
              WHERE c.board_uri LIKE $1 AND NOT c.hidden
              AND NOT EXISTS (
                SELECT 1 FROM atmobb_bans bn
                WHERE bn.did = c.author_did
                  AND bn.forum_did IN (split_part(c.board_uri, '/', 3), $3)
                  AND (bn.board_uri IS NULL OR bn.board_uri = c.board_uri)
                  AND c.created_at > bn.since
                  AND (bn.until IS NULL OR c.created_at < bn.until))) AS threads,
           (SELECT COALESCE(SUM(c.reply_count),0)::int + COUNT(*)::int
              FROM atmobb_thread_stats c WHERE c.board_uri LIKE $1 AND NOT c.hidden
              AND NOT EXISTS (
                SELECT 1 FROM atmobb_bans bn
                WHERE bn.did = c.author_did
                  AND bn.forum_did IN (split_part(c.board_uri, '/', 3), $3)
                  AND (bn.board_uri IS NULL OR bn.board_uri = c.board_uri)
                  AND c.created_at > bn.since
                  AND (bn.until IS NULL OR c.created_at < bn.until))) AS posts,
           (SELECT COUNT(*)::int FROM happyview_records
              WHERE collection = $2 AND (record::jsonb)->>'forum' = $3) AS members
  ]], { "at://" .. forum .. "/%", NS .. ".forum.membership", forum })
  local t = totals[1] or {}

  local newest = db.raw([[
    SELECT m.did, m.created_at, (p.record::jsonb)->>'displayName' AS display_name
    FROM happyview_records m
    LEFT JOIN happyview_records p
      ON p.did = m.did AND p.collection = $3 AND p.rkey = 'self'
    WHERE m.collection = $1 AND (m.record::jsonb)->>'forum' = $2
    ORDER BY m.created_at DESC LIMIT 1
  ]], { NS .. ".forum.membership", forum, NS .. ".actor.profile" })

  local stats = { threads = t.threads or 0, posts = t.posts or 0, members = t.members or 0 }
  if newest[1] then
    stats.newestMember = {
      did = newest[1].did,
      at = newest[1].created_at,
      displayName = newest[1].display_name,
    }
  end

  return {
    forum = profile,
    boards = boards,
    categories = categories,
    stats = stats,
  }
end
