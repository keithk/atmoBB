-- Rebuild the materialized stats tables from indexed records. Backfills run
-- record.create scripts, but a repeated backfill can count an existing record
-- again, and action records can be processed before their thread stats rows.
-- Rebuilding after a completed job makes the derived state converge.
--
-- Run it as one transaction so readers never see empty tables:
--
--   docker compose exec -T postgres psql -1 -U happyview -d happyview \
--     < infra/rebuild-stats.sql

TRUNCATE atmobb_thread_stats, atmobb_post_counts, atmobb_bans,
         atmobb_member_windows, atmobb_forum_gating;

INSERT INTO atmobb_thread_stats
  (thread_uri, board_uri, author_did, title, created_at,
   reply_count, last_activity, last_reply_did)
SELECT t.uri, (t.record::jsonb)->>'board', t.did, (t.record::jsonb)->>'title', t.created_at,
       COALESCE(r.n, 0), COALESCE(GREATEST(r.last, t.created_at), t.created_at), r.last_did
FROM happyview_records t
LEFT JOIN (
  SELECT rr.target_uri, count(*)::int AS n, max(p.created_at) AS last,
         (array_agg(p.did ORDER BY p.created_at DESC))[1] AS last_did
  FROM happyview_record_refs rr
  JOIN happyview_records p
    ON p.uri = rr.source_uri AND p.collection = 'app.atmobb.discussion.reply'
  GROUP BY rr.target_uri
) r ON r.target_uri = t.uri
WHERE t.collection = 'app.atmobb.discussion.thread';

WITH posts AS (
  SELECT split_part((t.record::jsonb)->>'board', '/', 3) AS forum_did, t.did
  FROM happyview_records t
  WHERE t.collection = 'app.atmobb.discussion.thread'
  UNION ALL
  SELECT split_part((t.record::jsonb)->>'board', '/', 3) AS forum_did, r.did
  FROM happyview_records r
  JOIN happyview_records t
    ON t.uri = (r.record::jsonb)->'thread'->>'uri'
   AND t.collection = 'app.atmobb.discussion.thread'
  WHERE r.collection = 'app.atmobb.discussion.reply'
)
INSERT INTO atmobb_post_counts (forum_did, did, posts)
SELECT forum_did, did, count(*)::int
FROM posts
WHERE forum_did <> ''
GROUP BY forum_did, did;

-- Restore each thread's latest origin decision per flag: hide/unhide,
-- lock/unlock, pin/unpin. During an all-collection backfill an action can
-- run before its thread stats row exists.
WITH decisions AS (
  SELECT DISTINCT ON (thread_uri, flag) thread_uri, flag, action, decided_at
  FROM (
    SELECT (a.record::jsonb)->'subject'->>'uri' AS thread_uri,
           CASE (a.record::jsonb)->>'action'
             WHEN 'hide' THEN 'hidden' WHEN 'unhide' THEN 'hidden'
             WHEN 'lock' THEN 'locked' WHEN 'unlock' THEN 'locked'
             WHEN 'pin' THEN 'pinned' WHEN 'unpin' THEN 'pinned'
           END AS flag,
           (a.record::jsonb)->>'action' AS action,
           COALESCE((a.record::jsonb)->>'createdAt', a.created_at::text) AS decided_at,
           a.uri
    FROM happyview_records a
    JOIN atmobb_thread_stats t
      ON t.thread_uri = (a.record::jsonb)->'subject'->>'uri'
     AND split_part(t.board_uri, '/', 3) = a.did
    WHERE a.collection = 'app.atmobb.moderation.action'
      AND (a.record::jsonb)->>'action' IN ('hide', 'unhide', 'lock', 'unlock', 'pin', 'unpin')
      AND (a.record::jsonb)->'subject'->>'uri' IS NOT NULL
  ) actions
  ORDER BY thread_uri, flag, decided_at DESC, uri DESC
)
UPDATE atmobb_thread_stats s
SET hidden = COALESCE((SELECT action = 'hide' FROM decisions d
                       WHERE d.thread_uri = s.thread_uri AND d.flag = 'hidden'), false),
    locked = COALESCE((SELECT action = 'lock' FROM decisions d
                       WHERE d.thread_uri = s.thread_uri AND d.flag = 'locked'), false),
    locked_at = (SELECT decided_at FROM decisions d
                 WHERE d.thread_uri = s.thread_uri AND d.flag = 'locked' AND d.action = 'lock'),
    pinned = COALESCE((SELECT action = 'pin' FROM decisions d
                       WHERE d.thread_uri = s.thread_uri AND d.flag = 'pinned'), false)
WHERE s.thread_uri IN (SELECT thread_uri FROM decisions);

-- Active bans: the latest ban/unban per (forum, member, board scope), kept
-- when it's a ban.
INSERT INTO atmobb_bans (uri, forum_did, did, board_uri, since, until, reason)
SELECT uri, forum_did, member, board_uri, decided_at, until, reason
FROM (
  SELECT DISTINCT ON (a.did, (a.record::jsonb)->'subject'->>'did', COALESCE((a.record::jsonb)->>'board', ''))
         a.uri, a.did AS forum_did,
         (a.record::jsonb)->'subject'->>'did' AS member,
         (a.record::jsonb)->>'board' AS board_uri,
         (a.record::jsonb)->>'action' AS action,
         COALESCE((a.record::jsonb)->>'createdAt', a.created_at::text) AS decided_at,
         (a.record::jsonb)->>'expiresAt' AS until,
         (a.record::jsonb)->>'reason' AS reason
  FROM happyview_records a
  WHERE a.collection = 'app.atmobb.moderation.action'
    AND (a.record::jsonb)->>'action' IN ('ban', 'unban')
    AND (a.record::jsonb)->'subject'->>'did' IS NOT NULL
  ORDER BY a.did, (a.record::jsonb)->'subject'->>'did', COALESCE((a.record::jsonb)->>'board', ''),
           COALESCE((a.record::jsonb)->>'createdAt', a.created_at::text) DESC, a.uri DESC
) latest
WHERE action = 'ban';

-- Membership windows keep history, so unlike bans they are rebuilt by walking
-- each (forum, member)'s acceptMember, revokeMember, and forum-wide ban
-- actions in (createdAt, uri) order. Every close event is numbered; an accept
-- opens a window only if it is the first accept since the previous close
-- (so a duplicate accept is a no-op), and that window ends at the next close
-- event, or stays open when there is none. Two accept-revoke cycles yield two
-- closed rows.
WITH events AS (
  SELECT a.uri, a.did AS forum_did,
         (a.record::jsonb)->'subject'->>'did' AS member,
         COALESCE((a.record::jsonb)->>'createdAt', a.created_at) AS at,
         (a.record::jsonb)->>'action' <> 'acceptMember' AS is_close,
         (a.record::jsonb)->>'sponsor' AS sponsor,
         (a.record::jsonb)->>'via' AS via
  FROM happyview_records a
  WHERE a.collection = 'app.atmobb.moderation.action'
    AND (a.record::jsonb)->'subject'->>'did' IS NOT NULL
    AND ((a.record::jsonb)->>'action' IN ('acceptMember', 'revokeMember')
      OR ((a.record::jsonb)->>'action' = 'ban' AND (a.record::jsonb)->>'board' IS NULL))
), numbered AS (
  SELECT *, count(*) FILTER (WHERE is_close) OVER (
           PARTITION BY forum_did, member ORDER BY at, uri
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS closes_before
  FROM events
), opens AS (
  SELECT DISTINCT ON (forum_did, member, closes_before)
         forum_did, member, closes_before, at, uri, sponsor, via
  FROM numbered
  WHERE NOT is_close
  ORDER BY forum_did, member, closes_before, at, uri
)
INSERT INTO atmobb_member_windows (action_uri, forum_did, did, since, until, sponsor, via)
SELECT o.uri, o.forum_did, o.member, o.at, c.at, o.sponsor, o.via
FROM opens o
LEFT JOIN numbered c
  ON c.forum_did = o.forum_did AND c.member = o.member
 AND c.is_close AND c.closes_before = o.closes_before;

-- Gating periods walk the same way: gateForum opens, openForum closes, both
-- signed by the forum with its own account as subject.
WITH events AS (
  SELECT a.uri, a.did AS forum_did,
         COALESCE((a.record::jsonb)->>'createdAt', a.created_at) AS at,
         (a.record::jsonb)->>'action' = 'openForum' AS is_close,
         (a.record::jsonb)->>'mode' AS mode
  FROM happyview_records a
  WHERE a.collection = 'app.atmobb.moderation.action'
    AND (a.record::jsonb)->>'action' IN ('gateForum', 'openForum')
    AND (a.record::jsonb)->'subject'->>'did' = a.did
), numbered AS (
  SELECT *, count(*) FILTER (WHERE is_close) OVER (
           PARTITION BY forum_did ORDER BY at, uri
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS closes_before
  FROM events
), opens AS (
  SELECT DISTINCT ON (forum_did, closes_before) forum_did, closes_before, at, uri, mode
  FROM numbered
  WHERE NOT is_close
  ORDER BY forum_did, closes_before, at, uri
)
INSERT INTO atmobb_forum_gating (action_uri, forum_did, gated_since, opened_at, mode)
SELECT o.uri, o.forum_did, o.at, c.at, o.mode
FROM opens o
LEFT JOIN numbered c
  ON c.forum_did = o.forum_did AND c.is_close AND c.closes_before = o.closes_before;
