#!/bin/sh
# Every file that names a Happyview or atmobb release must agree. CI runs this
# so a bump that misses one file fails before it ships.
set -eu
cd "$(dirname "$0")/../.."

fail=0
report() {
  echo "check-pins: $*" >&2
  fail=1
}

expected_hv=$(sed -n 's/^ARG HAPPYVIEW_VERSION=//p' Dockerfile)
[ -n "$expected_hv" ] || { echo "check-pins: Dockerfile has no ARG HAPPYVIEW_VERSION" >&2; exit 1; }
for file in docker-compose.yml infra/appview-compose.yml infra/appview-compose.example.yml infra/release/compose.yml docs/self-hosting.md docs/happyview.md; do
  for tag in $(grep -o 'gamesgamesgamesgamesgames/happyview:[0-9][0-9A-Za-z.+-]*' "$file" | cut -d: -f2 | sort -u); do
    [ "$tag" = "$expected_hv" ] || report "$file pins happyview:$tag; Dockerfile says $expected_hv"
  done
done

expected_app=$(jq -er .version package.json)
for tag in $(grep -o 'ghcr.io/keithk/atmobb:[0-9][0-9A-Za-z.+-]*' infra/release/compose.yml | cut -d: -f2 | sort -u); do
  [ "$tag" = "$expected_app" ] || report "infra/release/compose.yml pins atmobb:$tag; package.json says $expected_app"
done

if [ -n "${GITHUB_REF_NAME:-}" ]; then
  case "$GITHUB_REF_NAME" in
    v*) [ "${GITHUB_REF_NAME#v}" = "$expected_app" ] ||
          report "tag $GITHUB_REF_NAME does not match package.json version $expected_app" ;;
  esac
fi

[ "$fail" -eq 0 ] && echo "check-pins: happyview $expected_hv, atmobb $expected_app"
exit "$fail"
