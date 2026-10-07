-- xrpc.query:app.atmobb.actor.getGuestbook
-- The entries signed in one member's guestbook on one forum, newest first by
-- index time. Entries live in the signers' repos; what shows is the owner's
-- call, made on their newest membership declaration for the forum: the
-- guestbook flag (absent = closed), the periods it was closed, and the
-- entries and signers they hid or blocked.
--
-- Nothing shows while the owner keeps it closed or is banned forum-wide. An
-- entry is dropped outright when it was indexed during a closed period, when
-- its signer is banned forum-wide now or shut out by a gate closed now (no
-- open membership window), or when the same signer has an earlier entry here
-- indexed less than 24 hours before it. An entry hidden by the forum (its
-- latest hide/unhide is a hide), hidden by the owner, or from a blocked
-- signer is dropped too, unless includeHidden asks for it flagged; hiding or
-- blocking never frees up the signer's 24 hours. Every time rule reads the
-- index time, never the signer's createdAt. Offset cursor.
--
-- Alongside the entries: open, whether the guestbook takes entries now (on,
-- owner not banned), and with viewer, viewerBlocked, whether the owner
-- blocked that signer, so the app can offer or refuse the sign form.
local NS = "app.atmobb"

function handle()
  local forum = params.forum
  local subject = params.subject
  if not forum then
    error("missing required parameter: forum")
  end
  if not subject then
    error("missing required parameter: subject")
  end
  local limit = tonumber(params.limit) or 20
  if limit < 1 then limit = 1 end
  if limit > 50 then limit = 50 end
  local offset = tonumber(params.cursor) or 0
  local include_hidden = params.includeHidden == true or params.includeHidden == "true"

  local rows = db.raw([[
    WITH owner AS (
      -- The owner's newest membership declaration for this forum, while the
      -- guestbook is on and the owner is not banned forum-wide.
      SELECT d.record::jsonb AS rec
      FROM (
        SELECT d.record
        FROM happyview_records d
        WHERE d.did = $2 AND d.collection = $4 AND (d.record::jsonb)->>'forum' = $1
        ORDER BY COALESCE((d.record::jsonb)->>'createdAt', d.created_at::text) DESC, d.uri DESC
        LIMIT 1
      ) d
      WHERE (d.record::jsonb)->'guestbook' = 'true'::jsonb
        AND NOT EXISTS (
          SELECT 1 FROM atmobb_bans bn
          WHERE bn.did = $2 AND bn.forum_did = $1 AND bn.board_uri IS NULL
            AND (bn.until IS NULL OR bn.until::timestamptz > now()))
    ),
    eligible AS (
      -- Entries for this forum and owner, indexed while the guestbook was
      -- open, by signers neither banned forum-wide nor shut out by a closed
      -- gate. The forum account is exempt from its own gate.
      SELECT e.uri, e.cid, e.did, e.record, e.created_at, e.created_at::timestamptz AS indexed
      FROM happyview_records e
      CROSS JOIN owner o
      WHERE e.collection = $3
        AND (e.record::jsonb)->>'forum' = $1
        AND (e.record::jsonb)->>'subject' = $2
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.rec->'guestbookClosed') = 'array'
                                         THEN o.rec->'guestbookClosed' ELSE '[]'::jsonb END) p(period)
          WHERE e.created_at::timestamptz >= (p.period->>'from')::timestamptz
            AND (p.period->>'to' IS NULL OR e.created_at::timestamptz < (p.period->>'to')::timestamptz))
        AND NOT EXISTS (
          SELECT 1 FROM atmobb_bans bn
          WHERE bn.did = e.did AND bn.forum_did = $1 AND bn.board_uri IS NULL
            AND (bn.until IS NULL OR bn.until::timestamptz > now()))
        AND (NOT EXISTS (
            SELECT 1 FROM atmobb_forum_gating g
            WHERE g.forum_did = $1 AND g.opened_at IS NULL)
          OR e.did = $1
          OR EXISTS (
            SELECT 1 FROM atmobb_member_windows mw
            WHERE mw.forum_did = $1 AND mw.did = e.did AND mw.until IS NULL))
    ),
    paced AS (
      -- One entry per signer in any 24 hours: a later one inside the window
      -- of an earlier eligible entry is dropped, hidden or not.
      SELECT e.*
      FROM eligible e
      WHERE NOT EXISTS (
        SELECT 1 FROM eligible p
        WHERE p.did = e.did
          AND (p.indexed, p.uri) < (e.indexed, e.uri)
          AND p.indexed > e.indexed - interval '24 hours')
    ),
    flagged AS (
      SELECT e.*,
        CASE
          WHEN (
            SELECT (a.record::jsonb)->>'action' FROM happyview_records a
            WHERE a.collection = $5 AND a.did = $1
              AND (a.record::jsonb)->'subject'->>'uri' = e.uri
              AND (a.record::jsonb)->>'action' IN ('hide','unhide')
            ORDER BY a.created_at DESC LIMIT 1
          ) = 'hide' THEN 'staff'
          WHEN (SELECT o.rec->'guestbookHidden' FROM owner o) @> jsonb_build_array(e.uri) THEN 'owner'
          WHEN (SELECT o.rec->'guestbookBlocked' FROM owner o) @> jsonb_build_array(e.did) THEN 'blocked'
        END AS hidden
      FROM paced e
    )
    SELECT f.uri, f.cid, f.did, f.record, f.created_at, f.hidden
    FROM flagged f
    WHERE $6 = 'true' OR f.hidden IS NULL
    ORDER BY f.indexed DESC, f.uri DESC
    LIMIT $7 OFFSET $8
  ]], { forum, subject, NS .. ".actor.guestbook", NS .. ".forum.membership",
        NS .. ".moderation.action", include_hidden and "true" or "false", limit, offset })

  local entries = toarray({})
  for i, row in ipairs(rows) do
    local rec = json.decode(row.record)
    entries[i] = {
      uri = row.uri,
      cid = row.cid,
      author = row.did,
      text = rec.text,
      createdAt = rec.createdAt,
      indexedAt = row.created_at,
      hidden = row.hidden,
    }
  end

  -- The owner's newest declaration again, for the open flag and the
  -- viewer's block: a row only while the guestbook is on and the owner is
  -- not banned forum-wide, the same rule the entries follow.
  local state = db.raw([[
    SELECT CASE WHEN $3::text <> '' AND (d.record::jsonb)->'guestbookBlocked' @> jsonb_build_array($3::text)
                THEN 'yes' ELSE 'no' END AS viewer_blocked
    FROM (
      SELECT d.record
      FROM happyview_records d
      WHERE d.did = $2 AND d.collection = $4 AND (d.record::jsonb)->>'forum' = $1
      ORDER BY COALESCE((d.record::jsonb)->>'createdAt', d.created_at::text) DESC, d.uri DESC
      LIMIT 1
    ) d
    WHERE (d.record::jsonb)->'guestbook' = 'true'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM atmobb_bans bn
        WHERE bn.did = $2 AND bn.forum_did = $1 AND bn.board_uri IS NULL
          AND (bn.until IS NULL OR bn.until::timestamptz > now()))
  ]], { forum, subject, params.viewer or "", NS .. ".forum.membership" })

  local result = { entries = entries, open = #state > 0 }
  if params.viewer then
    result.viewerBlocked = #state > 0 and state[1].viewer_blocked == "yes"
  end
  if #rows == limit then
    result.cursor = tostring(offset + limit)
  end
  return result
end
