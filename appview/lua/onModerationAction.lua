-- record.create:app.atmobb.moderation.action
-- Maintain the per-thread moderation flags on atmobb_thread_stats (hidden,
-- locked with when, pinned), the active-bans table, membership windows, and
-- gating periods. Thread flags only take the board owner's actions: the signer
-- (did) must match the board's authority. Bans, windows, and gating periods are
-- keyed by the signing forum, so any forum's actions shape its own views.
--
-- Windows and gating periods apply actions in (createdAt, uri) order relative
-- to the rows already there, so the table converges on what
-- infra/rebuild-stats.sql produces no matter which order records arrive in:
-- an accept checks the index for an already-indexed later revoke or forum-wide
-- ban and, finding one, inserts its window already closed; a close never
-- touches a window opened after it. Optional fields are passed as '' and
-- NULLIFed in SQL because db.raw stops binding at the first nil parameter.
function handle()
  if not (record and record.subject) then
    return record
  end
  local a = record.action
  if record.subject.did then
    local at = record.createdAt or now()
    local member = record.subject.did
    if a == "ban" then
      db.raw([[
        INSERT INTO atmobb_bans (uri, forum_did, did, board_uri, since, until, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (uri) DO NOTHING
      ]], { uri, did, member, record.board, at, record.expiresAt, record.reason })
    elseif a == "unban" then
      db.raw([[
        DELETE FROM atmobb_bans
        WHERE forum_did = $1 AND did = $2 AND COALESCE(board_uri, '') = COALESCE($3, '')
      ]], { did, member, record.board })
    end
    if a == "acceptMember" then
      db.raw([[
        INSERT INTO atmobb_member_windows (action_uri, forum_did, did, since, until, sponsor, via)
        SELECT $1::text, $2::text, $3::text, $4::text,
          (SELECT COALESCE((r.record::jsonb)->>'createdAt', r.created_at)
             FROM happyview_records r
            WHERE r.collection = 'app.atmobb.moderation.action'
              AND r.did = $2::text
              AND (r.record::jsonb)->'subject'->>'did' = $3::text
              AND ((r.record::jsonb)->>'action' = 'revokeMember'
                OR ((r.record::jsonb)->>'action' = 'ban' AND (r.record::jsonb)->>'board' IS NULL))
              AND (COALESCE((r.record::jsonb)->>'createdAt', r.created_at), r.uri) > ($4::text, $1::text)
            ORDER BY COALESCE((r.record::jsonb)->>'createdAt', r.created_at), r.uri
            LIMIT 1),
          NULLIF($5::text, ''), NULLIF($6::text, '')
        WHERE NOT EXISTS (
          SELECT 1 FROM atmobb_member_windows w
          WHERE w.forum_did = $2::text AND w.did = $3::text AND w.until IS NULL)
        ON CONFLICT (action_uri) DO NOTHING
      ]], { uri, did, member, at, record.sponsor or "", record.via or "" })
    elseif a == "revokeMember" or (a == "ban" and record.board == nil) then
      db.raw([[
        UPDATE atmobb_member_windows SET until = $3::text
        WHERE forum_did = $1::text AND did = $2::text AND until IS NULL
          AND (since, action_uri) < ($3::text, $4::text)
      ]], { did, member, at, uri })
    elseif a == "gateForum" and member == did then
      db.raw([[
        INSERT INTO atmobb_forum_gating (action_uri, forum_did, gated_since, opened_at, mode)
        SELECT $1::text, $2::text, $3::text,
          (SELECT COALESCE((r.record::jsonb)->>'createdAt', r.created_at)
             FROM happyview_records r
            WHERE r.collection = 'app.atmobb.moderation.action'
              AND r.did = $2::text
              AND (r.record::jsonb)->>'action' = 'openForum'
              AND (r.record::jsonb)->'subject'->>'did' = $2::text
              AND (COALESCE((r.record::jsonb)->>'createdAt', r.created_at), r.uri) > ($3::text, $1::text)
            ORDER BY COALESCE((r.record::jsonb)->>'createdAt', r.created_at), r.uri
            LIMIT 1),
          NULLIF($4::text, '')
        WHERE NOT EXISTS (
          SELECT 1 FROM atmobb_forum_gating g
          WHERE g.forum_did = $2::text AND g.opened_at IS NULL)
        ON CONFLICT (action_uri) DO NOTHING
      ]], { uri, did, at, record.mode or "" })
    elseif a == "openForum" and member == did then
      db.raw([[
        UPDATE atmobb_forum_gating SET opened_at = $2::text
        WHERE forum_did = $1::text AND opened_at IS NULL
          AND (gated_since, action_uri) < ($2::text, $3::text)
      ]], { did, at, uri })
    end
    return record
  end
  if not record.subject.uri then
    return record
  end
  local thread = record.subject.uri
  if a == "hide" or a == "unhide" then
    db.raw([[
      UPDATE atmobb_thread_stats SET hidden = $1
      WHERE thread_uri = $2 AND split_part(board_uri, '/', 3) = $3
    ]], { a == "hide", thread, did })
  elseif a == "lock" then
    db.raw([[
      UPDATE atmobb_thread_stats SET locked = true, locked_at = $1
      WHERE thread_uri = $2 AND split_part(board_uri, '/', 3) = $3
    ]], { record.createdAt or now(), thread, did })
  elseif a == "unlock" then
    db.raw([[
      UPDATE atmobb_thread_stats SET locked = false, locked_at = NULL
      WHERE thread_uri = $1 AND split_part(board_uri, '/', 3) = $2
    ]], { thread, did })
  elseif a == "pin" or a == "unpin" then
    db.raw([[
      UPDATE atmobb_thread_stats SET pinned = $1
      WHERE thread_uri = $2 AND split_part(board_uri, '/', 3) = $3
    ]], { a == "pin", thread, did })
  end
  return record
end
