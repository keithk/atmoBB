-- xrpc.query:app.atmobb.forum.getMembership
-- One account's standing with a forum, from the acceptance windows the
-- forum's acceptMember / revokeMember actions produce: accepted while an open
-- window exists; since, sponsor, and via come from the newest window either
-- way, so a removed member still reports who brought them in. sponsored lists
-- the currently accepted members this account sponsored.
function handle()
  local forum = params.forum
  if not forum then
    error("missing required parameter: forum")
  end
  local actor = params.actor
  if not actor then
    error("missing required parameter: actor")
  end

  local windows = db.raw([[
    SELECT since, until, sponsor, via
    FROM atmobb_member_windows
    WHERE forum_did = $1 AND did = $2
    ORDER BY since DESC, action_uri DESC
    LIMIT 1
  ]], { forum, actor })

  local sponsored_rows = db.raw([[
    SELECT did, since, via
    FROM atmobb_member_windows
    WHERE forum_did = $1 AND sponsor = $2 AND until IS NULL
    ORDER BY since ASC, did ASC
  ]], { forum, actor })

  local sponsored = toarray({})
  for i, row in ipairs(sponsored_rows) do
    sponsored[i] = { did = row.did, since = row.since, via = row.via }
  end

  local result = { accepted = false, sponsored = sponsored }
  local w = windows[1]
  if w then
    result.accepted = w["until"] == nil
    result.since = w.since
    result.sponsor = w.sponsor
    result.via = w.via
  end
  return result
end
