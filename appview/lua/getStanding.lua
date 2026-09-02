-- xrpc.query:app.atmobb.moderation.getStanding
-- A member's standing with a forum: bans still in force (from the derived
-- bans table, expired ones left out) and warnings, newest first.
local NS = "app.atmobb"

function handle()
  local forum = params.forum
  local actor = params.actor
  if not forum then error("missing required parameter: forum") end
  if not actor then error("missing required parameter: actor") end

  local ban_rows = db.raw([[
    SELECT uri, board_uri, since, until, reason
    FROM atmobb_bans
    WHERE forum_did = $1 AND did = $2
      AND (until IS NULL OR until::timestamptz > now())
    ORDER BY since DESC
  ]], { forum, actor })
  local bans = toarray({})
  for i, row in ipairs(ban_rows) do
    -- `until` is a Lua keyword, hence the bracket form.
    bans[i] = { uri = row.uri, board = row.board_uri, since = row.since, ["until"] = row["until"], reason = row.reason }
  end

  local warn_rows = db.raw([[
    SELECT uri, record, created_at FROM happyview_records
    WHERE collection = $1 AND did = $2
      AND (record::jsonb)->>'action' = 'warn'
      AND (record::jsonb)->'subject'->>'did' = $3
    ORDER BY created_at DESC
    LIMIT 50
  ]], { NS .. ".moderation.action", forum, actor })
  local warnings = toarray({})
  for i, row in ipairs(warn_rows) do
    local value = json.decode(row.record)
    warnings[i] = {
      uri = row.uri,
      board = value.board,
      reason = value.reason,
      createdAt = value.createdAt or row.created_at,
    }
  end

  return { bans = bans, warnings = warnings }
end
