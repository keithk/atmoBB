#!/bin/sh
# Configure the local Happyview instance for app.atmobb.*:
# tables, network-resolved record lexicons, local query/procedure lexicons,
# and Lua scripts. Idempotent. Run from anywhere.
# Deployment overrides: HV=http://127.0.0.1:3000 PG_EXEC="docker compose -f /path/to/compose.yml exec -T postgres"
set -e
cd "$(dirname "$0")/.."
TOKEN=${HAPPYVIEW_API_KEY:-}
if [ -z "$TOKEN" ] && [ -f .env ]; then
  TOKEN=$(sed -n 's/^HAPPYVIEW_API_KEY=//p' .env | tail -n 1)
fi
if [ -z "$TOKEN" ]; then
  echo "Set HAPPYVIEW_API_KEY or put HAPPYVIEW_API_KEY=hv_... in .env" >&2
  exit 1
fi
for command in curl jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to configure Happyview" >&2
    exit 1
  fi
done
HV=${HV:-http://127.0.0.1:3000}
PG_EXEC=${PG_EXEC:-"docker compose exec -T postgres"}
NS=app.atmobb

echo "== stats tables"
$PG_EXEC psql -v ON_ERROR_STOP=1 -q -U happyview -d happyview -c "
BEGIN;
CREATE TABLE IF NOT EXISTS atmobb_thread_stats (
  thread_uri   text PRIMARY KEY,
  board_uri    text NOT NULL,
  author_did   text NOT NULL,
  title        text NOT NULL,
  created_at   text NOT NULL,
  reply_count  integer NOT NULL DEFAULT 0,
  last_activity text NOT NULL,
  last_reply_did text
);
CREATE INDEX IF NOT EXISTS idx_atmobb_stats_board_activity
  ON atmobb_thread_stats (board_uri, last_activity DESC);
CREATE TABLE IF NOT EXISTS atmobb_delisted_forums (
  did         text PRIMARY KEY,
  reason      text,
  delisted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atmobb_post_counts (
  forum_did text NOT NULL,
  did       text NOT NULL,
  posts     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (forum_did, did)
);
ALTER TABLE atmobb_thread_stats ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE atmobb_thread_stats ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
ALTER TABLE atmobb_thread_stats ADD COLUMN IF NOT EXISTS locked_at text;
ALTER TABLE atmobb_thread_stats ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
-- Active bans, one row per ban action still in force. Posts a banned member
-- makes on the forum inside the window are dropped from that forum's views.
CREATE TABLE IF NOT EXISTS atmobb_bans (
  uri       text PRIMARY KEY,
  forum_did text NOT NULL,
  did       text NOT NULL,
  board_uri text,
  since     text NOT NULL,
  until     text,
  reason    text
);
CREATE INDEX IF NOT EXISTS idx_atmobb_bans_member ON atmobb_bans (did, forum_did);

-- Migrate the original global post-count table, then rebuild it from indexed
-- records so existing installs immediately get accurate per-forum totals.
ALTER TABLE atmobb_post_counts ADD COLUMN IF NOT EXISTS forum_did text;
TRUNCATE atmobb_post_counts;
ALTER TABLE atmobb_post_counts DROP CONSTRAINT IF EXISTS atmobb_post_counts_pkey;
ALTER TABLE atmobb_post_counts ALTER COLUMN forum_did SET NOT NULL;
ALTER TABLE atmobb_post_counts ADD PRIMARY KEY (forum_did, did);
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
COMMIT;"

echo "== record + def lexicons via network resolution"
for nsid in \
  $NS.richtext.facet $NS.richtext.block \
  $NS.actor.profile \
  $NS.forum.profile $NS.forum.board $NS.forum.category $NS.forum.moderator $NS.forum.membership $NS.forum.accessRequest \
  $NS.moderation.action \
  $NS.discussion.thread $NS.discussion.reply \
  $NS.poll.vote
do
  printf '%s: ' "$nsid"
  response=$(curl --fail-with-body --silent --show-error -X POST "$HV/admin/network-lexicons" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"nsid\":\"$nsid\"}")
  printf '%.120s\n' "$response"
done

echo "== query/procedure lexicons (local upload; our appview's API)"
upload_lex() {
  file=$1; extra=$2
  body=$(jq -n --slurpfile lex "$file" "{lexicon_json: \$lex[0]} + $extra")
  printf '%s: ' "$(basename "$file")"
  response=$(curl --fail-with-body --silent --show-error -X POST "$HV/admin/lexicons" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$body")
  printf '%.120s\n' "$response"
}
upload_lex lexicons/app/atmobb/actor/getActivity.json "{target_collection: \"$NS.actor.profile\"}"
upload_lex lexicons/app/atmobb/forum/getBoardIndex.json "{target_collection: \"$NS.forum.board\"}"
upload_lex lexicons/app/atmobb/discussion/getBoardThreads.json "{target_collection: \"$NS.discussion.thread\"}"
upload_lex lexicons/app/atmobb/discussion/getThreadPage.json "{target_collection: \"$NS.discussion.reply\"}"
upload_lex lexicons/app/atmobb/discussion/getLatestThreads.json "{target_collection: \"$NS.discussion.thread\"}"
upload_lex lexicons/app/atmobb/forum/getMembers.json "{target_collection: \"$NS.actor.profile\"}"
upload_lex lexicons/app/atmobb/forum/getDirectory.json "{target_collection: \"$NS.forum.profile\"}"
upload_lex lexicons/app/atmobb/forum/getStaff.json "{target_collection: \"$NS.forum.moderator\"}"
upload_lex lexicons/app/atmobb/forum/getAccessRequests.json "{target_collection: \"$NS.forum.accessRequest\"}"
upload_lex lexicons/app/atmobb/moderation/getLog.json "{target_collection: \"$NS.moderation.action\"}"
upload_lex lexicons/app/atmobb/moderation/getStanding.json "{target_collection: \"$NS.moderation.action\"}"
upload_lex lexicons/app/atmobb/forum/getTopic.json "{target_collection: \"$NS.forum.board\"}"
upload_lex lexicons/app/atmobb/forum/getTopics.json "{target_collection: \"$NS.forum.board\"}"
upload_lex lexicons/app/atmobb/discussion/createThread.json "{target_collection: \"$NS.discussion.thread\", action: \"create\"}"
upload_lex lexicons/app/atmobb/discussion/createReply.json "{target_collection: \"$NS.discussion.reply\", action: \"create\"}"

echo "== lua scripts"
upload_script() {
  trigger=$1; file=$2
  body=$(jq -n --rawfile code "appview/lua/$file" --arg id "$trigger" \
    '{id: $id, body: $code}')
  printf '%s: ' "$trigger"
  response=$(curl --fail-with-body --silent --show-error -X POST "$HV/admin/scripts" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$body")
  printf '%.60s\n' "$response"
}
upload_script "xrpc.query:$NS.actor.getActivity" getActorActivity.lua
upload_script "xrpc.query:$NS.forum.getBoardIndex" getBoardIndex.lua
upload_script "xrpc.query:$NS.discussion.getBoardThreads" getBoardThreads.lua
upload_script "xrpc.query:$NS.discussion.getThreadPage" getThreadPage.lua
upload_script "xrpc.query:$NS.discussion.getLatestThreads" getLatestThreads.lua
upload_script "xrpc.query:$NS.forum.getMembers" getMembers.lua
upload_script "xrpc.query:$NS.forum.getDirectory" getDirectory.lua
upload_script "xrpc.query:$NS.forum.getStaff" getStaff.lua
upload_script "xrpc.query:$NS.forum.getAccessRequests" getAccessRequests.lua
upload_script "xrpc.query:$NS.moderation.getLog" getModerationLog.lua
upload_script "xrpc.query:$NS.moderation.getStanding" getStanding.lua
upload_script "xrpc.query:$NS.forum.getTopic" getTopic.lua
upload_script "xrpc.query:$NS.forum.getTopics" getTopics.lua
upload_script "record.create:$NS.discussion.thread" onThreadCreate.lua
upload_script "record.update:$NS.discussion.thread" onThreadUpdate.lua
upload_script "record.delete:$NS.discussion.thread" onThreadDelete.lua
upload_script "record.create:$NS.discussion.reply" onReplyCreate.lua
upload_script "record.delete:$NS.discussion.reply" onReplyDelete.lua
upload_script "record.create:$NS.moderation.action" onModerationAction.lua

echo "== done"
