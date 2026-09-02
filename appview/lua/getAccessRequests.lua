-- xrpc.query:app.atmobb.forum.getAccessRequests
-- Open access requests for a forum's members-only boards. An accessRequest
-- lives in the requester's repo and points at a board in the forum's repo. We
-- surface the ones still pending: no deny or revoke decided after the request
-- was made. Only decisions newer than the request count, so asking again after
-- a denial (a fresh accessRequest record) reopens the case. The "already a
-- member" filter happens in the app layer (space membership lives in
-- Happyview's space tables, not in happyview_records).
local NS = "app.atmobb"

function handle()
  local forum = params.forum
  if not forum then
    error("missing required parameter: forum")
  end

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
  ]], { forum, NS .. ".forum.board", NS .. ".actor.profile",
        NS .. ".forum.accessRequest", NS .. ".moderation.action" })

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

  return { requests = requests }
end
