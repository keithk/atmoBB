-- xrpc.query:app.atmobb.forum.getDirectory
-- Every forum the index has seen (any account with a forum profile),
-- in founding order. Powers the directory and the atmosphere webring.
local NS = "app.atmobb"

function handle()
  local rows = db.raw([[
    SELECT did, record, created_at FROM happyview_records
    WHERE collection = $1 AND rkey = 'self'
      AND did NOT IN (SELECT did FROM atmobb_delisted_forums)
    ORDER BY created_at ASC
  ]], { NS .. ".forum.profile" })

  local forums = toarray({})
  for i, row in ipairs(rows) do
    local value = json.decode(row.record)
    forums[i] = {
      did = row.did,
      name = value.name,
      description = value.description,
      createdAt = row.created_at,
    }
  end

  return { forums = forums }
end
