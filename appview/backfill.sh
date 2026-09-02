#!/bin/sh
# Backfill every registered record collection, wait for the asynchronous job,
# then rebuild atmobb's derived stats. Safe to rerun. Run from anywhere.
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
    echo "$command is required to backfill Happyview" >&2
    exit 1
  fi
done

HV=${HV:-http://127.0.0.1:3000}
PG_EXEC=${PG_EXEC:-"docker compose exec -T postgres"}
WAIT_SECONDS=${WAIT_SECONDS:-5}

echo "== starting backfill for all registered record collections"
created=$(curl --fail-with-body --silent --show-error -X POST "$HV/admin/backfill" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}')
job_id=$(printf '%s' "$created" | jq -er '.id')
echo "job: $job_id"

while :; do
  jobs=$(curl --fail-with-body --silent --show-error "$HV/admin/backfill/status" \
    -H "Authorization: Bearer $TOKEN")
  job=$(printf '%s' "$jobs" | jq -c --arg id "$job_id" '.[] | select(.id == $id)')
  if [ -z "$job" ]; then
    echo "Backfill job $job_id was missing from the status response" >&2
    exit 1
  fi
  status=$(printf '%s' "$job" | jq -r '.status')
  stage=$(printf '%s' "$job" | jq -r '.stage')
  progress=$(printf '%s' "$job" | jq -r '"repos \(.processed_repos // 0)/\(.total_repos // "?"), records \(.total_records // 0)"')
  printf '  %s: %s (%s)\n' "$status" "$stage" "$progress"
  case "$status" in
    completed) break ;;
    failed|cancelled)
      printf '%s\n' "$job" | jq -r '.error // "backfill did not complete"' >&2
      exit 1
      ;;
    paused)
      echo "Backfill is paused; resume it in Happyview before rerunning this script" >&2
      exit 1
      ;;
  esac
  sleep "$WAIT_SECONDS"
done

echo "== rebuilding thread and post stats"
$PG_EXEC psql -1 -q -U happyview -d happyview < infra/rebuild-stats.sql
echo "== done"
