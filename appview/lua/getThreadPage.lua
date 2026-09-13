-- xrpc.query:app.atmobb.discussion.getThreadPage
-- One page of a thread: thread + replies in chronological order, with author
-- profiles (display name, signature) and worn stamps hydrated. Offset cursor.
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
                  THEN (d.record::jsonb)->'wearing' ELSE '[]'::jsonb END AS ids,
             jsonb_typeof((d.record::jsonb)->'wearing') = 'array' AS chose
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
             COALESCE((SELECT wr.chose FROM wearing wr WHERE wr.did = t.did), false) AS chose,
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

local function author_profile(did)
  local rows = db.raw([[
    SELECT ap.record AS profile
    FROM happyview_records ap
    WHERE ap.did = $1 AND ap.collection = $2 AND ap.rkey = 'self'
  ]], { did, NS .. ".actor.profile" })
  local row = rows[1] or {}
  if row.profile then return json.decode(row.profile) end
  return nil
end

function handle()
  local thread_uri = params.thread
  if not thread_uri then
    error("missing required parameter: thread")
  end
  local forum = params.forum
  if not forum then
    error("missing required parameter: forum")
  end
  local limit = tonumber(params.limit) or 25
  if limit > 100 then limit = 100 end
  local offset = tonumber(params.cursor) or 0

  local thread = db.get(thread_uri)
  local thread_author = nil
  local thread_cid = nil
  if thread then
    -- at://did/collection/rkey -> did
    thread_author = thread_uri:match("^at://([^/]+)/")
    local meta = db.raw(
      [[SELECT cid FROM happyview_records WHERE uri = $1]], { thread_uri })
    thread_cid = meta[1] and meta[1].cid or nil
  end

  local stats = db.raw([[
    SELECT reply_count, hidden, locked, locked_at, pinned, board_uri, created_at
    FROM atmobb_thread_stats WHERE thread_uri = $1
  ]], { thread_uri })
  local stat = stats[1] or {}
  local reply_count = stat.reply_count or 0

  -- A locked thread stops taking replies at the moment of the lock. Members
  -- can still write reply records from any client, so the cut is applied
  -- here: replies after locked_at are dropped unless their author holds a
  -- staff grant from the forum, who may still post a closing word.
  local lock_cut = ""
  if stat.locked and stat.locked_at then
    lock_cut = stat.locked_at
    local open = db.raw([[
      SELECT count(*)::int AS n
      FROM happyview_record_refs r
      JOIN happyview_records p ON p.uri = r.source_uri AND p.collection = $2
      WHERE r.target_uri = $1
        AND (p.created_at <= $3 OR EXISTS (
          SELECT 1 FROM happyview_records m
          WHERE m.collection = $4 AND m.did = $5
            AND (m.record::jsonb)->>'subject' = p.did))
    ]], { thread_uri, NS .. ".discussion.reply", lock_cut, NS .. ".forum.moderator", forum })
    reply_count = (open[1] and open[1].n) or 0
  end

  -- Hidden for this forum: the origin's hide (the flag) or, for a federated
  -- thread, this forum's own latest hide/unhide. The app decides who may
  -- still see a hidden thread (staff, for the undo affordance).
  local hidden = stat.hidden or false
  -- A thread its author posted while banned (by its origin forum, or by
  -- this one) is hidden from this forum on the same terms as a hide.
  if not hidden and thread and stat.board_uri then
    local banned = db.raw([[
      SELECT 1 AS ok FROM atmobb_bans bn
      WHERE bn.did = $1 AND bn.forum_did IN (split_part($2, '/', 3), $3)
        AND (bn.board_uri IS NULL OR bn.board_uri = $2)
        AND $4 > bn.since AND (bn.until IS NULL OR $4 < bn.until)
      LIMIT 1
    ]], { thread_author, stat.board_uri, forum, stat.created_at })
    hidden = #banned > 0
  end
  -- A thread written at a gated board by someone its forum had not accepted
  -- at the time is hidden on the same terms; the forum's own account is exempt.
  if not hidden and thread and stat.board_uri then
    local outside = db.raw([[
      SELECT 1 AS ok
      WHERE EXISTS (
          SELECT 1 FROM atmobb_forum_gating g
          WHERE g.forum_did = split_part($2, '/', 3)
            AND g.gated_since <= $3
            AND (g.opened_at IS NULL OR $3 < g.opened_at))
        AND $1 <> split_part($2, '/', 3)
        AND NOT EXISTS (
          SELECT 1 FROM atmobb_member_windows w
          WHERE w.forum_did = split_part($2, '/', 3) AND w.did = $1
            AND w.since <= $3
            AND (w.until IS NULL OR $3 < w.until))
    ]], { thread_author, stat.board_uri, stat.created_at })
    hidden = #outside > 0
  end
  if not hidden and thread and forum then
    local mine = db.raw([[
      SELECT (a.record::jsonb)->>'action' AS action FROM happyview_records a
      WHERE a.collection = $1 AND a.did = $2
        AND (a.record::jsonb)->'subject'->>'uri' = $3
        AND (a.record::jsonb)->>'action' IN ('hide','unhide')
      ORDER BY a.created_at DESC LIMIT 1
    ]], { NS .. ".moderation.action", forum, thread_uri })
    hidden = (mine[1] and mine[1].action == "hide") or false
  end

  -- A permalink asks for the page holding one reply: its position in the
  -- chronological order picks the offset, and replyIndex reports it back.
  local reply_index = nil
  if params.reply then
    local pos = db.raw([[
      SELECT count(*)::int AS n
      FROM happyview_record_refs r
      JOIN happyview_records p ON p.uri = r.source_uri AND p.collection = $2
      JOIN happyview_records t ON t.uri = $3
      WHERE r.target_uri = $1 AND (p.created_at, p.uri) < (t.created_at, t.uri)
    ]], { thread_uri, NS .. ".discussion.reply", params.reply })
    local present = db.raw([[
      SELECT 1 AS ok FROM happyview_record_refs
      WHERE source_uri = $1 AND target_uri = $2 LIMIT 1
    ]], { params.reply, thread_uri })
    if present[1] then
      reply_index = (pos[1] and pos[1].n) or 0
      offset = math.floor(reply_index / limit) * limit
    end
  end

  local rows = db.raw([[
    SELECT p.uri, p.cid, p.did, p.record, p.created_at,
           ap.record AS author_profile
    FROM happyview_record_refs r
    JOIN happyview_records p ON p.uri = r.source_uri AND p.collection = $2
    LEFT JOIN happyview_records ap
      ON ap.did = p.did AND ap.collection = $3 AND ap.rkey = 'self'
    WHERE r.target_uri = $1
      AND ($7 = '' OR p.created_at <= $7 OR EXISTS (
        SELECT 1 FROM happyview_records m
        WHERE m.collection = $8 AND m.did = $4
          AND (m.record::jsonb)->>'subject' = p.did))
      AND NOT EXISTS (
        SELECT 1 FROM atmobb_bans bn
        WHERE bn.did = p.did AND bn.forum_did IN (split_part($9, '/', 3), $4)
          AND (bn.board_uri IS NULL OR bn.board_uri = $9)
          AND p.created_at > bn.since AND (bn.until IS NULL OR p.created_at < bn.until))
      AND (NOT EXISTS (
          SELECT 1 FROM atmobb_forum_gating g
          WHERE g.forum_did = split_part($9, '/', 3)
            AND g.gated_since <= p.created_at
            AND (g.opened_at IS NULL OR p.created_at < g.opened_at))
        OR p.did = split_part($9, '/', 3)
        OR EXISTS (
          SELECT 1 FROM atmobb_member_windows w
          WHERE w.forum_did = split_part($9, '/', 3)
            AND w.did = p.did
            AND w.since <= p.created_at
            AND (w.until IS NULL OR p.created_at < w.until)))
    ORDER BY p.created_at ASC, p.uri ASC
    LIMIT $5 OFFSET $6
  ]], { thread_uri, NS .. ".discussion.reply", NS .. ".actor.profile", forum,
        limit, offset, lock_cut, NS .. ".forum.moderator", stat.board_uri or "" })

  -- Worn stamps come from one resolution over the page's distinct authors.
  local authors = {}
  local seen = {}
  if thread_author then
    authors[#authors + 1] = thread_author
    seen[thread_author] = true
  end
  for _, row in ipairs(rows) do
    if not seen[row.did] then
      authors[#authors + 1] = row.did
      seen[row.did] = true
    end
  end
  local stamps = resolve_stamps(forum, authors)

  local replies = toarray({})
  for i, row in ipairs(rows) do
    local profile = nil
    if row.author_profile then profile = json.decode(row.author_profile) end
    replies[i] = {
      uri = row.uri,
      cid = row.cid,
      author = row.did,
      authorProfile = profile,
      authorStamps = worn_stamps(stamps, row.did),
      value = json.decode(row.record),
      indexedAt = row.created_at,
    }
  end

  -- Poll tally. Votes are one record per chosen option in each voter's repo.
  -- A single-choice poll counts each voter's latest vote; a multiple-choice
  -- poll counts each (voter, option) once. Votes after closesAt don't count.
  -- The viewer's own vote records come back so the app can change or retract.
  -- On a gated forum a vote only counts (and only comes back) if its voter
  -- held an acceptance window when it was cast.
  local poll = nil
  if thread and thread.poll and thread.poll.options then
    local n = #thread.poll.options
    local votes = db.raw([[
      SELECT v.uri, v.did, (v.record::jsonb)->>'option' AS opt,
             COALESCE((v.record::jsonb)->>'createdAt', v.created_at::text) AS at
      FROM happyview_record_refs r
      JOIN happyview_records v ON v.uri = r.source_uri AND v.collection = $2
      WHERE r.target_uri = $1
        AND (NOT EXISTS (
            SELECT 1 FROM atmobb_forum_gating g
            WHERE g.forum_did = split_part($3, '/', 3)
              AND g.gated_since <= COALESCE((v.record::jsonb)->>'createdAt', v.created_at::text)
              AND (g.opened_at IS NULL OR COALESCE((v.record::jsonb)->>'createdAt', v.created_at::text) < g.opened_at))
          OR v.did = split_part($3, '/', 3)
          OR EXISTS (
            SELECT 1 FROM atmobb_member_windows w
            WHERE w.forum_did = split_part($3, '/', 3)
              AND w.did = v.did
              AND w.since <= COALESCE((v.record::jsonb)->>'createdAt', v.created_at::text)
              AND (w.until IS NULL OR COALESCE((v.record::jsonb)->>'createdAt', v.created_at::text) < w.until)))
      ORDER BY at ASC, v.uri ASC
    ]], { thread_uri, NS .. ".poll.vote", stat.board_uri or "" })
    local closes = thread.poll.closesAt
    local multiple = thread.poll.multipleChoice == true
    local by_did = {}
    local mine = toarray({})
    for _, row in ipairs(votes) do
      local opt = tonumber(row.opt)
      if row.did == params.viewer then
        mine[#mine + 1] = { uri = row.uri, option = opt }
      end
      if opt and opt >= 0 and opt < n and (closes == nil or row.at <= closes) then
        if multiple then
          by_did[row.did] = by_did[row.did] or {}
          by_did[row.did][opt] = true
        else
          by_did[row.did] = { [opt] = true }
        end
      end
    end
    local counts = {}
    for i = 1, n do counts[i] = 0 end
    local voters = 0
    local viewer_options = toarray({})
    for did, opts in pairs(by_did) do
      voters = voters + 1
      for opt in pairs(opts) do
        counts[opt + 1] = counts[opt + 1] + 1
        if did == params.viewer then viewer_options[#viewer_options + 1] = opt end
      end
    end
    poll = { counts = toarray(counts), voters = voters, viewerVotes = mine, viewerOptions = viewer_options }
  end

  local result = { replies = replies, replyCount = reply_count, replyIndex = reply_index, poll = poll }
  if thread then
    local profile = author_profile(thread_author)
    -- A thread whose board belongs to another forum carries its origin, plus
    -- whether this forum can see it through topic federation (same dial as
    -- getLatestThreads: the origin board shares a topic with one of this
    -- forum's boards and that board's federation setting admits it).
    local origin = nil
    local board_uri = thread.board
    local origin_did = board_uri and string.match(board_uri, "^at://([^/]+)/") or nil
    if origin_did and origin_did ~= forum then
      local fed = db.raw([[
        SELECT 1 AS ok
        FROM happyview_records mine, happyview_records b
        WHERE mine.collection = $1 AND mine.did = $2
          AND (mine.record::jsonb)->>'topic' IS NOT NULL
          AND b.uri = $3 AND b.collection = $1
          AND (b.record::jsonb)->>'topic' = (mine.record::jsonb)->>'topic'
          AND (COALESCE((mine.record::jsonb)->>'topicFederation', 'open') = 'open'
               OR b.did = mine.did
               OR COALESCE((mine.record::jsonb)->'topicAllow', '[]'::jsonb) @> to_jsonb(b.did::text))
          AND b.did NOT IN (SELECT did FROM atmobb_delisted_forums)
        LIMIT 1
      ]], { NS .. ".forum.board", forum, board_uri })
      local fp = db.raw([[
        SELECT (record::jsonb)->>'name' AS name FROM happyview_records
        WHERE did = $1 AND collection = $2 AND rkey = 'self'
      ]], { origin_did, NS .. ".forum.profile" })
      origin = {
        did = origin_did,
        name = fp[1] and fp[1].name or nil,
        federated = #fed > 0,
      }
    end
    result.thread = {
      uri = thread_uri,
      cid = thread_cid,
      author = thread_author,
      authorProfile = profile,
      authorStamps = worn_stamps(stamps, thread_author),
      value = thread,
      origin = origin,
      hidden = hidden,
      locked = stat.locked or false,
      lockedAt = stat.locked_at,
      pinned = stat.pinned or false,
    }
  end
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
