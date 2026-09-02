-- record.create:app.atmobb.moderation.action
-- Maintain the per-thread moderation flags on atmobb_thread_stats (hidden,
-- locked with when, pinned) and the active-bans table. Thread flags only
-- take the board owner's actions: the signer (did) must match the board's
-- authority. Bans are keyed by the signing forum, so any forum's ban shapes
-- its own views.
function handle()
  if not (record and record.subject) then
    return record
  end
  local a = record.action
  if record.subject.did then
    if a == "ban" then
      db.raw([[
        INSERT INTO atmobb_bans (uri, forum_did, did, board_uri, since, until, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (uri) DO NOTHING
      ]], { uri, did, record.subject.did, record.board, record.createdAt or now(),
            record.expiresAt, record.reason })
    elseif a == "unban" then
      db.raw([[
        DELETE FROM atmobb_bans
        WHERE forum_did = $1 AND did = $2 AND COALESCE(board_uri, '') = COALESCE($3, '')
      ]], { did, record.subject.did, record.board })
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
