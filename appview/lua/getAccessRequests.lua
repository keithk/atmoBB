-- xrpc.query:app.atmobb.forum.getAccessRequests
-- Open access requests for a forum. An accessRequest lives in the requester's
-- repo and points at either a board in the forum's repo (kind=board, the
-- default) or the forum itself (kind=forum, an application to join).
--
-- Board requests: the ones still pending, meaning no deny or revoke decided
-- after the request was made. Only decisions newer than the request count, so
-- asking again after a denial (a fresh accessRequest record) reopens the case.
-- The "already a member" filter happens in the app layer (space membership
-- lives in Happyview's space tables, not in happyview_records).
--
-- Forum applications: one row per applicant, their newest application, with
-- a state from the newest forum-level decision (one with no board) at or
-- after the application: acceptMember, holdApplication (waiting), denyAccess
-- (denied), otherwise pending. Accepted applications and applicants who
-- currently hold an open membership window are left out; denied ones stay so
-- staff can see them. Offset cursor on both kinds.
local NS = "app.atmobb"

local function board_requests(forum, limit, offset)
  local rows = db.raw([[
    SELECT r.uri, r.did AS requester, r.created_at,
           (r.record::jsonb)->>'board' AS board,
           (r.record::jsonb)->>'reason' AS reason,
           b.record AS board_record,
           p.record AS requester_profile
    FROM happyview_records r
    JOIN happyview_records b
      ON b.uri = (r.record::jsonb)->>'board'
     AND b.collection = $2 AND b.did = $1
    LEFT JOIN happyview_records p
      ON p.did = r.did AND p.collection = $3 AND p.rkey = 'self'
    WHERE r.collection = $4
      AND NOT COALESCE((
        SELECT (a.record::jsonb)->>'action' FROM happyview_records a
        WHERE a.collection = $5 AND a.did = $1
          AND (a.record::jsonb)->'subject'->>'did' = r.did
          AND (a.record::jsonb)->>'board' = (r.record::jsonb)->>'board'
          AND (a.record::jsonb)->>'action' IN ('grantAccess','denyAccess','revokeAccess')
          AND a.created_at > r.created_at
        ORDER BY a.created_at DESC LIMIT 1
      ) IN ('denyAccess','revokeAccess'), false)
    ORDER BY r.created_at ASC
    LIMIT $6 OFFSET $7
  ]], { forum, NS .. ".forum.board", NS .. ".actor.profile",
        NS .. ".forum.accessRequest", NS .. ".moderation.action", limit, offset })

  local requests = toarray({})
  for i, row in ipairs(rows) do
    local board_name = nil
    if row.board_record then board_name = (json.decode(row.board_record)).name end
    local profile = nil
    if row.requester_profile then profile = json.decode(row.requester_profile) end
    requests[i] = {
      uri = row.uri,
      requester = row.requester,
      board = row.board,
      boardName = board_name,
      reason = row.reason,
      createdAt = row.created_at,
      requesterProfile = profile,
    }
  end
  return rows, requests
end

local STATES = { holdApplication = "waiting", denyAccess = "denied" }

local function forum_applications(forum, limit, offset)
  local rows = db.raw([[
    WITH applications AS (
      SELECT DISTINCT ON (r.did)
             r.uri, r.cid, r.did, r.created_at,
             (r.record::jsonb)->>'reason' AS reason
      FROM happyview_records r
      WHERE r.collection = $2 AND (r.record::jsonb)->>'forum' = $1
      ORDER BY r.did, r.created_at DESC, r.uri DESC
    ),
    decided AS (
      SELECT a.*,
             (SELECT (d.record::jsonb)->>'action' FROM happyview_records d
              WHERE d.collection = $3 AND d.did = $1
                AND (d.record::jsonb)->'subject'->>'did' = a.did
                AND (d.record::jsonb)->>'board' IS NULL
                AND (d.record::jsonb)->>'action' IN ('acceptMember','holdApplication','denyAccess')
                AND d.created_at >= a.created_at
              ORDER BY d.created_at DESC, d.uri DESC LIMIT 1) AS decision
      FROM applications a
    )
    SELECT a.uri, a.cid, a.did AS requester, a.created_at, a.reason, a.decision,
           p.record AS requester_profile
    FROM decided a
    LEFT JOIN happyview_records p
      ON p.did = a.did AND p.collection = $4 AND p.rkey = 'self'
    WHERE COALESCE(a.decision, '') <> 'acceptMember'
      AND NOT EXISTS (
        SELECT 1 FROM atmobb_member_windows w
        WHERE w.forum_did = $1 AND w.did = a.did AND w.until IS NULL)
    ORDER BY a.created_at ASC
    LIMIT $5 OFFSET $6
  ]], { forum, NS .. ".forum.accessRequest", NS .. ".moderation.action",
        NS .. ".actor.profile", limit, offset })

  local requests = toarray({})
  for i, row in ipairs(rows) do
    local profile = nil
    if row.requester_profile then profile = json.decode(row.requester_profile) end
    requests[i] = {
      uri = row.uri,
      cid = row.cid,
      requester = row.requester,
      reason = row.reason,
      createdAt = row.created_at,
      requesterProfile = profile,
      state = STATES[row.decision] or "pending",
    }
  end
  return rows, requests
end

function handle()
  local forum = params.forum
  if not forum then
    error("missing required parameter: forum")
  end
  local kind = params.kind or "board"
  local limit = tonumber(params.limit) or 50
  if limit > 100 then limit = 100 end
  local offset = tonumber(params.cursor) or 0

  local rows, requests
  if kind == "forum" then
    rows, requests = forum_applications(forum, limit, offset)
  elseif kind == "board" then
    rows, requests = board_requests(forum, limit, offset)
  else
    error("unknown kind: " .. kind)
  end

  local result = { requests = requests }
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
