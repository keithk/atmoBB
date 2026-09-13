-- xrpc.query:app.atmobb.forum.getMembers
-- Members of one forum by arrival, with profiles and the stamps they wear.
-- Membership records are scoped to the forum; activity is scoped to its own
-- boards. While the forum is gated, a member is someone the forum has
-- accepted (an open window) who also declared membership, and each row
-- carries the acceptance's sponsor, via, and since. On an open forum since is
-- the declaration's createdAt. Offset cursor.
local NS = "app.atmobb"

-- Profiles created before this moment hold the network's "early days" stamp.
-- Two months after stamps shipped: room for the first wave to arrive, and
-- the same on every forum this appview serves.
local EARLY_DAYS_CUTOFF = "2026-10-01T00:00:00Z"

-- What each member of a forum holds and wears, resolved at read time from
-- the forum's stamp definitions, the durable firsts rows, membership windows,
-- profile dates, and open by-hand awards. One row per tray entry, worn ones
-- first. This SQL is duplicated verbatim in getStamps, getThreadPage,
-- getMembers, and getMembership: scripts cannot share code, and the
-- integration test checks the copies still match.
local function resolve_stamps(forum, dids)
  if #dids == 0 then return {} end
  local rows = db.raw([[
    -- Tray resolution: forum $1, comma-joined member DIDs $2, early days cutoff $3.
    WITH members AS (
      SELECT DISTINCT m.did FROM unnest(string_to_array($2::text, ',')) AS m(did)
    ),
    hide AS (
      SELECT COALESCE(bool_or(((fp.record::jsonb)->>'hideDefaultStamps')::boolean), false) AS defaults
      FROM happyview_records fp
      WHERE fp.did = $1 AND fp.collection = 'app.atmobb.forum.profile' AND fp.rkey = 'self'
    ),
    defs AS (
      -- A firstPostInBoard stamp whose board is gone reads as retired.
      SELECT s.uri, s.cid,
             (s.record::jsonb)->>'name' AS name,
             ((s.record::jsonb)->'look')::text AS look,
             (s.record::jsonb)->'trigger'->>'kind' AS kind,
             (s.record::jsonb)->'trigger'->>'board' AS board,
             (s.record::jsonb)->'trigger'->>'before' AS before,
             (s.record::jsonb)->'trigger'->>'via' AS via,
             COALESCE((s.record::jsonb)->>'createdAt', s.created_at::text) AS created_at
      FROM happyview_records s
      WHERE s.did = $1 AND s.collection = 'app.atmobb.forum.stamp'
        AND ((s.record::jsonb)->'trigger'->>'kind' IS DISTINCT FROM 'firstPostInBoard'
          OR EXISTS (
            SELECT 1 FROM happyview_records b
            WHERE b.uri = (s.record::jsonb)->'trigger'->>'board'
              AND b.collection = 'app.atmobb.forum.board'))
    ),
    windows AS (
      -- The member's latest acceptance on this forum, open or closed.
      SELECT DISTINCT ON (w.did) w.did, w.since, w.sponsor, w.via
      FROM atmobb_member_windows w
      JOIN members m ON m.did = w.did
      WHERE w.forum_did = $1
      ORDER BY w.did, w.since DESC, w.action_uri DESC
    ),
    profiles AS (
      SELECT m.did, (ap.record::jsonb)->>'createdAt' AS created_at
      FROM members m
      JOIN happyview_records ap
        ON ap.did = m.did AND ap.collection = 'app.atmobb.actor.profile' AND ap.rkey = 'self'
    ),
    wearing AS (
      -- The member's newest membership declaration for this forum.
      SELECT DISTINCT ON (d.did) d.did,
             CASE WHEN jsonb_typeof((d.record::jsonb)->'wearing') = 'array'
                  THEN (d.record::jsonb)->'wearing' ELSE '[]'::jsonb END AS ids
      FROM happyview_records d
      JOIN members m ON m.did = d.did
      WHERE d.collection = 'app.atmobb.forum.membership' AND (d.record::jsonb)->>'forum' = $1
      ORDER BY d.did, COALESCE((d.record::jsonb)->>'createdAt', d.created_at::text) DESC, d.uri DESC
    ),
    held AS (
      -- Admin stamps whose trigger the member satisfies.
      SELECT m.did, d.uri AS id, d.name, 'admin' AS source, d.uri, d.cid, d.look,
             NULL::text AS board, NULL::text AS board_color, NULL::text AS via, NULL::text AS sponsor,
             d.created_at AS earned_at
      FROM members m CROSS JOIN defs d
      WHERE (d.kind = 'firstPostInBoard' AND EXISTS (
              SELECT 1 FROM atmobb_firsts f
              WHERE f.forum_did = $1 AND f.did = m.did AND f.board_uri = d.board))
         OR (d.kind = 'firstPostHere' AND EXISTS (
              SELECT 1 FROM atmobb_firsts f
              WHERE f.forum_did = $1 AND f.did = m.did AND f.board_uri IS NULL))
         OR (d.kind = 'profileBefore' AND EXISTS (
              SELECT 1 FROM profiles p WHERE p.did = m.did AND p.created_at < d.before))
         OR (d.kind = 'arrivedBy' AND EXISTS (
              SELECT 1 FROM windows w WHERE w.did = m.did AND w.via = d.via))
      UNION ALL
      -- Open by-hand awards of any admin stamp.
      SELECT m.did, d.uri, d.name, 'byHand', d.uri, d.cid, d.look,
             NULL, NULL, NULL, NULL, a.created_at
      FROM members m
      JOIN atmobb_stamp_awards a
        ON a.forum_did = $1 AND a.did = m.did AND a.revoked_at IS NULL
      JOIN defs d ON d.uri = a.stamp_uri
      UNION ALL
      -- Default: one per board the member first posted in, unless hidden.
      SELECT m.did, 'atmobb:board:' || f.board_uri, (b.record::jsonb)->>'name', 'default',
             NULL, NULL, NULL, f.board_uri, (b.record::jsonb)->>'color', NULL, NULL, f.first_at
      FROM members m
      JOIN atmobb_firsts f ON f.forum_did = $1 AND f.did = m.did AND f.board_uri IS NOT NULL
      JOIN happyview_records b ON b.uri = f.board_uri AND b.collection = 'app.atmobb.forum.board'
      WHERE NOT (SELECT defaults FROM hide)
      UNION ALL
      -- Default: arrival by invite, application, or founding, unless hidden.
      SELECT m.did, 'atmobb:arrival',
             CASE w.via WHEN 'founding' THEN 'original member' ELSE 'brought in' END, 'default',
             NULL, NULL, NULL, NULL, NULL, w.via, w.sponsor, w.since
      FROM members m
      JOIN windows w ON w.did = m.did
      WHERE w.via IN ('invite', 'application', 'founding')
        AND NOT (SELECT defaults FROM hide)
      UNION ALL
      -- Network: first light for a first post on any forum this appview indexes.
      SELECT m.did, 'atmobb:first-light', 'first light', 'network',
             NULL, NULL, '{"bg":"#fff3c4","ink":"#5b4300","shape":"stamp"}', NULL, NULL, NULL, NULL,
             (SELECT MIN(f.first_at) FROM atmobb_firsts f WHERE f.did = m.did AND f.board_uri IS NULL)
      FROM members m
      WHERE EXISTS (SELECT 1 FROM atmobb_firsts f WHERE f.did = m.did AND f.board_uri IS NULL)
      UNION ALL
      -- Network: early days for a profile older than the cutoff.
      SELECT m.did, 'atmobb:early-days', 'early days', 'network',
             NULL, NULL, '{"bg":"#e4e0ff","ink":"#2b1f6b","shape":"ticket"}', NULL, NULL, NULL, NULL,
             p.created_at
      FROM members m
      JOIN profiles p ON p.did = m.did
      WHERE p.created_at < $3
    ),
    tray AS (
      -- A stamp both triggered and awarded by hand counts once, as triggered.
      SELECT DISTINCT ON (h.did, h.id) h.*
      FROM held h
      ORDER BY h.did, h.id, (h.source = 'byHand')
    ),
    ranked AS (
      SELECT t.*,
             (SELECT MIN(e.ordinality)::int
                FROM wearing wr, jsonb_array_elements_text(wr.ids) WITH ORDINALITY e(id, ordinality)
               WHERE wr.did = t.did AND e.id = t.id) AS wearing_pos,
             COALESCE((SELECT jsonb_array_length(wr.ids) > 0 FROM wearing wr WHERE wr.did = t.did), false) AS chose,
             ROW_NUMBER() OVER (PARTITION BY t.did
               ORDER BY (t.source <> 'default'), t.earned_at DESC, t.id) AS default_rank
      FROM tray t
    )
    -- worn_rank: the member's own order when they chose, else the newest
    -- defaults; the caller keeps the first three.
    SELECT r.did, r.id, r.name, r.source, r.uri, r.cid, r.look, r.board, r.board_color,
           r.via, r.sponsor, r.earned_at,
           CASE WHEN r.chose THEN r.wearing_pos
                WHEN r.source = 'default' THEN r.default_rank::int END AS worn_rank
    FROM ranked r
    ORDER BY r.did, worn_rank NULLS LAST, r.earned_at DESC NULLS LAST, r.id
  ]], { forum, table.concat(dids, ","), EARLY_DAYS_CUTOFF })

  local by_did = {}
  for _, row in ipairs(rows) do
    local member = by_did[row.did]
    if not member then
      member = { tray = toarray({}), worn = toarray({}) }
      by_did[row.did] = member
    end
    local entry = {
      id = row.id,
      name = row.name,
      source = row.source,
      uri = row.uri,
      cid = row.cid,
      board = row.board,
      boardColor = row.board_color,
      via = row.via,
      sponsor = row.sponsor,
    }
    if row.look then entry.look = json.decode(row.look) end
    member.tray[#member.tray + 1] = entry
    if row.worn_rank and #member.worn < 3 then
      member.worn[#member.worn + 1] = entry
    end
  end
  return by_did
end

-- The worn entries for one member, or an empty list.
local function worn_stamps(by_did, did)
  local member = by_did[did]
  return member and member.worn or toarray({})
end

function handle()
  local forum = params.forum
  if not forum then
    error("missing required parameter: forum")
  end
  local limit = tonumber(params.limit) or 50
  if limit > 100 then limit = 100 end
  local offset = tonumber(params.cursor) or 0

  local gated = db.raw([[
    SELECT 1 AS ok FROM atmobb_forum_gating
    WHERE forum_did = $1 AND opened_at IS NULL
    LIMIT 1
  ]], { forum })

  local members_cte
  if #gated > 0 then
    members_cte = [[
      WITH members AS (
        SELECT w.did, w.since, w.sponsor, w.via
        FROM atmobb_member_windows w
        WHERE w.forum_did = $3 AND w.until IS NULL
          AND EXISTS (
            SELECT 1 FROM happyview_records d
            WHERE d.collection = $1 AND d.did = w.did AND (d.record::jsonb)->>'forum' = $3)
      )
    ]]
  else
    members_cte = [[
      WITH members AS (
        SELECT did, MIN(COALESCE((record::jsonb)->>'createdAt', created_at::text)) AS since,
               NULL::text AS sponsor, NULL::text AS via
        FROM happyview_records
        WHERE collection = $1 AND (record::jsonb)->>'forum' = $3
        GROUP BY did
      )
    ]]
  end

  local rows = db.raw(members_cte .. [[
    SELECT m.did, m.since, m.sponsor, m.via,
           ap.record AS profile,
           (SELECT MAX(s.last_activity) FROM atmobb_thread_stats s
             WHERE s.board_uri LIKE $2
               AND (s.author_did = m.did OR s.last_reply_did = m.did)) AS last_active
    FROM members m
    LEFT JOIN happyview_records ap
      ON ap.did = m.did AND ap.collection = $4 AND ap.rkey = 'self'
    ORDER BY m.since ASC NULLS LAST, m.did ASC
    LIMIT $5 OFFSET $6
  ]], { NS .. ".forum.membership", "at://" .. forum .. "/%", forum,
        NS .. ".actor.profile", limit, offset })

  local dids = {}
  for i, row in ipairs(rows) do dids[i] = row.did end
  local stamps = resolve_stamps(forum, dids)

  local members = toarray({})
  for i, row in ipairs(rows) do
    local profile = nil
    if row.profile then profile = json.decode(row.profile) end
    members[i] = {
      did = row.did,
      profile = profile,
      lastActive = row.last_active,
      since = row.since,
      sponsor = row.sponsor,
      via = row.via,
      stamps = worn_stamps(stamps, row.did),
    }
  end

  local result = { members = members }
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
