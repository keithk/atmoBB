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
         atmobb_member_windows, atmobb_forum_gating,
         atmobb_firsts, atmobb_stamp_awards;

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

-- First-seen posts: each member's earliest served thread or reply per board,
-- plus one per forum (board_uri NULL). Served is what getActorActivity
-- serves: a board that exists without a space, on a forum that is not
-- delisted, not hidden at its origin, and on a gated forum inside the
-- author's membership window (the forum account excepted). The create
-- triggers write these rows as posts arrive and nothing removes them, so a
-- rebuild differs only for posts hidden or deleted since, whose stamps it
-- takes back. Runs after the gating block so the windows it reads are there.
WITH served_threads AS (
  SELECT s.thread_uri, s.board_uri, s.author_did, COALESCE(NULLIF(s.created_at, ''), t.created_at::text) AS created_at, b.did AS forum_did
  FROM atmobb_thread_stats s
  JOIN happyview_records t
    ON t.uri = s.thread_uri AND t.collection = 'app.atmobb.discussion.thread'
  JOIN happyview_records b
    ON b.uri = s.board_uri AND b.collection = 'app.atmobb.forum.board'
  WHERE NOT s.hidden
    AND (b.record::jsonb)->'access'->>'space' IS NULL
    AND b.did NOT IN (SELECT did FROM atmobb_delisted_forums)
    AND (NOT EXISTS (
        SELECT 1 FROM atmobb_forum_gating g
        WHERE g.forum_did = b.did
          AND g.gated_since <= COALESCE(NULLIF(s.created_at, ''), t.created_at::text)
          AND (g.opened_at IS NULL OR COALESCE(NULLIF(s.created_at, ''), t.created_at::text) < g.opened_at))
      OR s.author_did = b.did
      OR EXISTS (
        SELECT 1 FROM atmobb_member_windows w
        WHERE w.forum_did = b.did
          AND w.did = s.author_did
          AND w.since <= COALESCE(NULLIF(s.created_at, ''), t.created_at::text)
          AND (w.until IS NULL OR COALESCE(NULLIF(s.created_at, ''), t.created_at::text) < w.until)))
), replies AS (
  SELECT t.forum_did, r.did, t.board_uri,
         COALESCE((r.record::jsonb)->>'createdAt', r.created_at) AS posted_at, r.uri
  FROM happyview_records r
  JOIN served_threads t
    ON t.thread_uri = (r.record::jsonb)->'thread'->>'uri'
  WHERE r.collection = 'app.atmobb.discussion.reply'
), posts AS (
  SELECT forum_did, author_did AS did, board_uri, created_at AS posted_at, thread_uri AS uri
  FROM served_threads
  UNION ALL
  SELECT r.forum_did, r.did, r.board_uri, r.posted_at, r.uri
  FROM replies r
  WHERE (NOT EXISTS (
        SELECT 1 FROM atmobb_forum_gating g
        WHERE g.forum_did = r.forum_did
          AND g.gated_since <= r.posted_at
          AND (g.opened_at IS NULL OR r.posted_at < g.opened_at))
      OR r.did = r.forum_did
      OR EXISTS (
        SELECT 1 FROM atmobb_member_windows w
        WHERE w.forum_did = r.forum_did
          AND w.did = r.did
          AND w.since <= r.posted_at
          AND (w.until IS NULL OR r.posted_at < w.until)))
)
INSERT INTO atmobb_firsts (forum_did, did, board_uri, first_at, source_uri)
SELECT DISTINCT ON (forum_did, did, board_uri) forum_did, did, board_uri, posted_at, uri
FROM (
  SELECT forum_did, did, board_uri, posted_at, uri FROM posts
  UNION ALL
  SELECT forum_did, did, NULL, posted_at, uri FROM posts
) scoped
ORDER BY forum_did, did, board_uri, posted_at, uri;

-- By-hand stamp awards: per (forum, member, stamp) the newest awardStamp,
-- revoked when a revokeStamp follows it. Only actions whose stamp lives in
-- the signing forum's repo count, as in the trigger.
WITH events AS (
  SELECT a.uri, a.did AS forum_did,
         (a.record::jsonb)->'subject'->>'did' AS member,
         (a.record::jsonb)->'ref'->>'uri' AS stamp_uri,
         (a.record::jsonb)->>'action' = 'awardStamp' AS is_award,
         (a.record::jsonb)->>'actor' AS actor,
         COALESCE((a.record::jsonb)->>'createdAt', a.created_at) AS at
  FROM happyview_records a
  WHERE a.collection = 'app.atmobb.moderation.action'
    AND (a.record::jsonb)->>'action' IN ('awardStamp', 'revokeStamp')
    AND (a.record::jsonb)->'subject'->>'did' IS NOT NULL
    AND split_part((a.record::jsonb)->'ref'->>'uri', '/', 3) = a.did
), latest AS (
  SELECT DISTINCT ON (forum_did, member, stamp_uri) forum_did, member, stamp_uri, actor, at, uri
  FROM events
  WHERE is_award
  ORDER BY forum_did, member, stamp_uri, at DESC, uri DESC
)
INSERT INTO atmobb_stamp_awards (forum_did, did, stamp_uri, actor_did, created_at, revoked_at)
SELECT l.forum_did, l.member, l.stamp_uri, l.actor, l.at,
       (SELECT max(r.at) FROM events r
         WHERE NOT r.is_award
           AND r.forum_did = l.forum_did AND r.member = l.member AND r.stamp_uri = l.stamp_uri
           AND (r.at, r.uri) > (l.at, l.uri))
FROM latest l;
