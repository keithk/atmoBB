-- xrpc.query:app.atmobb.moderation.getLog
-- A forum's moderation actions, newest first, with display context: thread
-- titles for strongRef subjects, forum names for account subjects, stamp
-- names for awardStamp and revokeStamp. The family param narrows to
-- thread-and-account moderation or to membership decisions.
local NS = "app.atmobb"

local FAMILIES = {
  moderation = { "hide", "unhide", "lock", "unlock", "pin", "unpin",
                 "ban", "unban", "warn", "block", "unblock",
                 "awardStamp", "revokeStamp" },
  membership = { "acceptMember", "revokeMember", "holdApplication",
                 "grantAccess", "denyAccess", "revokeAccess",
                 "gateForum", "openForum" },
}

function handle()
  local forum = params.forum
  if not forum then
    error("missing required parameter: forum")
  end
  local limit = tonumber(params.limit) or 50
  if limit > 100 then limit = 100 end

  -- The family's action names are fixed above, never taken from the request,
  -- so splicing them into the SQL as literals is safe.
  local family_filter = ""
  if params.family then
    local kinds = FAMILIES[params.family]
    if not kinds then
      error("unknown family: " .. params.family)
    end
    family_filter = " AND (a.record::jsonb)->>'action' IN ('" .. table.concat(kinds, "','") .. "')"
  end

  local rows = db.raw([[
    SELECT a.uri, a.record, a.created_at,
           s.title AS thread_title,
           (fp.record::jsonb)->>'name' AS subject_forum_name,
           (mp.record::jsonb)->>'displayName' AS subject_name,
           (st.record::jsonb)->>'name' AS stamp_name
    FROM happyview_records a
    LEFT JOIN atmobb_thread_stats s
      ON s.thread_uri = (a.record::jsonb)->'subject'->>'uri'
    LEFT JOIN happyview_records fp
      ON fp.did = (a.record::jsonb)->'subject'->>'did'
     AND fp.collection = $3 AND fp.rkey = 'self'
    LEFT JOIN happyview_records mp
      ON mp.did = (a.record::jsonb)->'subject'->>'did'
     AND mp.collection = $5 AND mp.rkey = 'self'
    LEFT JOIN happyview_records st
      ON st.uri = (a.record::jsonb)->'ref'->>'uri'
     AND st.collection = $6
    WHERE a.collection = $1 AND a.did = $2]] .. family_filter .. [[

    ORDER BY a.created_at DESC
    LIMIT $4
  ]], { NS .. ".moderation.action", forum, NS .. ".forum.profile", limit, NS .. ".actor.profile", NS .. ".forum.stamp" })

  local actions = toarray({})
  for i, row in ipairs(rows) do
    local value = json.decode(row.record)
    actions[i] = {
      uri = row.uri,
      value = value,
      createdAt = value.createdAt or row.created_at,
      threadTitle = row.thread_title,
      subjectForumName = row.subject_forum_name,
      subjectName = row.subject_name,
      stampName = row.stamp_name,
    }
  end

  return { actions = actions }
end
