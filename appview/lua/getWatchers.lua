-- xrpc.query:app.atmobb.forum.getWatchers
-- Members watching one board, for notification dispatch. Watch records live
-- in the member's repo and point at the board; a mounted board's URI names
-- another forum's DID, so bans are matched against both that origin and the
-- asking forum. A ban still in force hides the watcher. Offset cursor.
local NS = "app.atmobb"

function handle()
  local forum = params.forum
  local board = params.board
  if not forum then
    error("missing required parameter: forum")
  end
  if not board then
    error("missing required parameter: board")
  end
  local limit = tonumber(params.limit) or 100
  if limit > 500 then limit = 500 end
  local offset = tonumber(params.cursor) or 0

  local rows = db.raw([[
    SELECT DISTINCT w.did
    FROM happyview_records w
    WHERE w.collection = $1 AND (w.record::jsonb)->>'board' = $2
      AND NOT EXISTS (
        SELECT 1 FROM atmobb_bans bn
        WHERE bn.did = w.did
          AND bn.forum_did IN (split_part($2, '/', 3), $3)
          AND (bn.board_uri IS NULL OR bn.board_uri = $2)
          AND (bn.until IS NULL OR bn.until::timestamptz > now()))
    ORDER BY w.did ASC
    LIMIT $4 OFFSET $5
  ]], { NS .. ".forum.watch", board, forum, limit, offset })

  local watchers = toarray({})
  for i, row in ipairs(rows) do
    watchers[i] = { did = row.did }
  end

  local result = { watchers = watchers }
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
