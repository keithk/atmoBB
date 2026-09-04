#!/bin/sh
# Entrypoint for the `setup` service in the release Compose bundle. Runs in
# the atmobb image before the web app starts, on every `docker compose up`:
#
#   1. wait for Happyview to answer;
#   2. refuse to continue if the running Happyview is not the release this
#      atmobb build was tested against (HAPPYVIEW_EXPECTED_VERSION, baked into
#      the image), so a half-upgraded stack fails loudly instead of serving
#      pages against an index it does not understand;
#   3. run the idempotent appview/setup.sh.
#
# Expects HV, HAPPYVIEW_API_KEY, and libpq's PGHOST/PGUSER/PGPASSWORD/PGDATABASE
# in the environment, with PG_EXEC set to the empty string.
set -eu
cd "$(dirname "$0")/.."

HV=${HV:-http://happyview:3000}
EXPECTED=${HAPPYVIEW_EXPECTED_VERSION:?the atmobb image must define HAPPYVIEW_EXPECTED_VERSION}

die() {
  echo "atmobb setup: $*" >&2
  exit 1
}

[ -n "${HAPPYVIEW_API_KEY:-}" ] ||
  die "HAPPYVIEW_API_KEY is empty. Run './atmobb install' once to create the Happyview operator key."

echo "== waiting for Happyview at $HV"
attempt=0
until curl --fail --silent --show-error --output /dev/null "$HV/health" 2>/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || die "Happyview did not answer $HV/health after 120 seconds"
  sleep 2
done

# /config sits behind Happyview's Host check (421 otherwise); /admin and /health
# do not. Send the public hostname when we reach it over the Compose network.
[ -n "${HAPPYVIEW_HOST:-}" ] || die "HAPPYVIEW_HOST is empty; the setup service needs the public Happyview hostname"
running=$(curl --fail --silent --show-error -H "Host: $HAPPYVIEW_HOST" "$HV/config" | jq -r '.version // empty')
[ -n "$running" ] || die "could not read Happyview's version from $HV/config"
if [ "$running" != "$EXPECTED" ]; then
  cat >&2 <<EOF
atmobb setup: Happyview version mismatch.

  running:  $running
  expected: $EXPECTED  (this atmobb release was tested against it)

Happyview upgrades run forward-only database migrations, so atmobb will not
start against a version it has not been tested with. Back up Postgres, then
run './atmobb upgrade-happyview' to move the stack together.
EOF
  exit 1
fi
echo "== Happyview $running matches this release"

HV="$HV" PG_EXEC="" sh appview/setup.sh
