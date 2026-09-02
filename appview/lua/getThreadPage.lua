-- xrpc.query:app.atmobb.discussion.getThreadPage
-- One page of a thread: thread + replies in chronological order, with author
-- profiles (display name, signature) and postcounts hydrated. Offset cursor.
local NS = "app.atmobb"

local function author_info(did, forum)
  local rows = db.raw([[
    SELECT ap.record AS profile, COALESCE(pc.posts, 0) AS posts,
           COALESCE((SELECT SUM(pca.posts) FROM atmobb_post_counts pca
             WHERE pca.did = d.did), 0)::int AS total_posts
    FROM (SELECT $1::text AS did) d
    LEFT JOIN happyview_records ap
      ON ap.did = d.did AND ap.collection = $2 AND ap.rkey = 'self'
    LEFT JOIN atmobb_post_counts pc ON pc.did = d.did AND pc.forum_did = $3
  ]], { did, NS .. ".actor.profile", forum })
  local row = rows[1] or {}
  local profile = nil
  if row.profile then profile = json.decode(row.profile) end
  return profile, row.posts or 0, row.total_posts or 0
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
           ap.record AS author_profile, COALESCE(pc.posts, 0) AS author_posts,
           COALESCE((SELECT SUM(pca.posts) FROM atmobb_post_counts pca
             WHERE pca.did = p.did), 0)::int AS author_total_posts
    FROM happyview_record_refs r
    JOIN happyview_records p ON p.uri = r.source_uri AND p.collection = $2
    LEFT JOIN happyview_records ap
      ON ap.did = p.did AND ap.collection = $3 AND ap.rkey = 'self'
    LEFT JOIN atmobb_post_counts pc ON pc.did = p.did AND pc.forum_did = $4
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
    ORDER BY p.created_at ASC, p.uri ASC
    LIMIT $5 OFFSET $6
  ]], { thread_uri, NS .. ".discussion.reply", NS .. ".actor.profile", forum,
        limit, offset, lock_cut, NS .. ".forum.moderator", stat.board_uri or "" })

  local replies = toarray({})
  for i, row in ipairs(rows) do
    local profile = nil
    if row.author_profile then profile = json.decode(row.author_profile) end
    replies[i] = {
      uri = row.uri,
      cid = row.cid,
      author = row.did,
      authorProfile = profile,
      authorPosts = row.author_posts,
      authorTotalPosts = row.author_total_posts,
      value = json.decode(row.record),
      indexedAt = row.created_at,
    }
  end

  -- Poll tally. Votes are one record per chosen option in each voter's repo.
  -- A single-choice poll counts each voter's latest vote; a multiple-choice
  -- poll counts each (voter, option) once. Votes after closesAt don't count.
  -- The viewer's own vote records come back so the app can change or retract.
  local poll = nil
  if thread and thread.poll and thread.poll.options then
    local n = #thread.poll.options
    local votes = db.raw([[
      SELECT v.uri, v.did, (v.record::jsonb)->>'option' AS opt,
             COALESCE((v.record::jsonb)->>'createdAt', v.created_at::text) AS at
      FROM happyview_record_refs r
      JOIN happyview_records v ON v.uri = r.source_uri AND v.collection = $2
      WHERE r.target_uri = $1
      ORDER BY at ASC, v.uri ASC
    ]], { thread_uri, NS .. ".poll.vote" })
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
    local profile, posts, total_posts = author_info(thread_author, forum)
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
      authorPosts = posts,
      authorTotalPosts = total_posts,
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
