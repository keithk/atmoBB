-- xrpc.query:app.atmobb.forum.getStaff
-- A forum's staff: moderator records signed by the forum, with subject
-- profiles for display.
local NS = "app.atmobb"

function handle()
  local forum = params.forum
  if not forum then
    error("missing required parameter: forum")
  end

  local rows = db.raw([[
    SELECT m.uri, m.record, m.created_at,
           p.record AS profile
    FROM happyview_records m
    LEFT JOIN happyview_records p
      ON p.did = (m.record::jsonb)->>'subject' AND p.collection = $2 AND p.rkey = 'self'
    WHERE m.collection = $1 AND m.did = $3
    ORDER BY m.created_at ASC
  ]], { NS .. ".forum.moderator", NS .. ".actor.profile", forum })

  local staff = toarray({})
  for i, row in ipairs(rows) do
    local value = json.decode(row.record)
    local profile = nil
    if row.profile then profile = json.decode(row.profile) end
    staff[i] = {
      uri = row.uri,
      subject = value.subject,
      role = value.role,
      boards = value.boards,
      createdAt = value.createdAt or row.created_at,
      subjectProfile = profile,
    }
  end

  return { staff = staff }
end
