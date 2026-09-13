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
  local query = params.q or ""
  local board_filter = params.board or ""
  local tag = params.tag or ""
  local thread_filter = params.uri or ""

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
           ap.record AS author_profile,
           ((tr.record::jsonb)->'tags')::text AS tags,
           pa.participants
    FROM atmobb_thread_stats s
    LEFT JOIN happyview_records b ON b.uri = s.board_uri
    LEFT JOIN happyview_records tr ON tr.uri = s.thread_uri
    LEFT JOIN happyview_records opf
      ON opf.did = split_part(s.board_uri, '/', 3) AND opf.collection = $5 AND opf.rkey = 'self'
    LEFT JOIN happyview_records ap
      ON ap.did = s.author_did AND ap.collection = $1 AND ap.rkey = 'self'
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
            JOIN happyview_records rp ON rp.uri = rr.source_uri AND rp.collection = $12
            LEFT JOIN happyview_records rap
              ON rap.did = rp.did AND rap.collection = $1 AND rap.rkey = 'self'
            WHERE rr.target_uri = s.thread_uri
              AND (NOT s.locked OR s.locked_at IS NULL OR rp.created_at <= s.locked_at OR EXISTS (
                SELECT 1 FROM happyview_records m
                WHERE m.collection = $13 AND m.did = $7
                  AND (m.record::jsonb)->>'subject' = rp.did))
              AND NOT EXISTS (
                SELECT 1 FROM atmobb_bans bn
                WHERE bn.did = rp.did
                  AND bn.forum_did IN (split_part(s.board_uri, '/', 3), $7)
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
    WHERE NOT s.hidden
      -- Members-only boards never surface in the public feed: their real
      -- threads live in the permissioned space, so anything here is a leak/stale.
      AND (b.record::jsonb)->'access'->>'space' IS NULL
      AND (s.board_uri LIKE $6 OR s.board_uri IN (SELECT uri FROM peers))
      -- v1 search is deliberately title-only. strpos treats %, _ and \\ literally.
      AND ($9 = '' OR strpos(lower(s.title), lower($9)) > 0)
      AND ($10 = '' OR s.board_uri = $10)
      AND ($14 = '' OR s.thread_uri = $14)
      AND ($11 = '' OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE((tr.record::jsonb)->'tags', '[]'::jsonb)) jt(value)
        WHERE lower(jt.value) = lower($11)))
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
    ORDER BY s.last_activity DESC
    LIMIT $2 OFFSET $3
  ]], { NS .. ".actor.profile", limit, offset, NS .. ".forum.board",
        NS .. ".forum.profile", scope_prefix, scope_forum,
        NS .. ".moderation.action", query, board_filter, tag,
        NS .. ".discussion.reply", NS .. ".forum.moderator", thread_filter })

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
      tags = tags,
      createdAt = row.created_at,
      replyCount = row.reply_count,
      lastActivity = row.last_activity,
      lastReplyBy = row.last_reply_did,
      participants = participants,
      origin = origin,
    }
  end

  local result = { threads = threads }
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
