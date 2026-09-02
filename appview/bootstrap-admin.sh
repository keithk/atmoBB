#!/bin/sh
# Create the Happyview super user and mint an admin API key for it.
# Run once per instance, before appview/setup.sh (which needs the key).
#
#   ADMIN_DID=did:plc:yourdid sh appview/bootstrap-admin.sh
#
# Production (container name follows the compose project):
#   ADMIN_DID=did:plc:yourdid PG_EXEC="docker exec my-postgres-container" \
#     sh appview/bootstrap-admin.sh
#
# Prints the API key once; only its hash is stored. Rerunning with the same
# DID rotates the key.
set -e
cd "$(dirname "$0")/.."

ADMIN_DID=${ADMIN_DID:?set ADMIN_DID to the atproto DID that should own this instance}
PG_EXEC=${PG_EXEC:-"docker compose exec -T postgres"}

if ! printf '%s\n' "$ADMIN_DID" | grep -Eq '^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$'; then
  echo "ADMIN_DID must be a DID (for example, did:plc:abc123), not a handle" >&2
  exit 1
fi

echo "== waiting for Happyview migrations" >&2
attempt=0
until $PG_EXEC psql -qAt -U happyview -d happyview \
  -c "SELECT to_regclass('public.happyview_users') IS NOT NULL" 2>/dev/null | grep -qx t
do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Happyview's database schema was not ready after 60 seconds" >&2
    echo "Check the containers with: docker compose ps && docker compose logs happyview" >&2
    exit 1
  fi
  sleep 2
done

TOKEN="hv_$(openssl rand -hex 24)"
HASH=$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hex | awk '{print $NF}')
PREFIX=$(printf '%s' "$TOKEN" | cut -c1-7)
PERMISSIONS='["lexicons:create","scripts:manage","backfill:create","backfill:read","settings:manage"]'
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

$PG_EXEC psql -q -U happyview -d happyview -c "
WITH u AS (
  INSERT INTO happyview_users (id, did, is_super, created_at)
  VALUES ('admin', '$ADMIN_DID', 1, '$NOW')
  ON CONFLICT (did) DO UPDATE SET is_super = 1
  RETURNING id
)
INSERT INTO happyview_api_keys (id, user_id, name, key_hash, key_prefix, permissions, created_at)
SELECT 'admin-key', u.id, 'bootstrap admin', '$HASH', '$PREFIX', '$PERMISSIONS', '$NOW' FROM u
ON CONFLICT (id) DO UPDATE
  SET key_hash = EXCLUDED.key_hash, key_prefix = EXCLUDED.key_prefix,
      user_id = EXCLUDED.user_id, permissions = EXCLUDED.permissions, revoked_at = NULL;"

printf 'HAPPYVIEW_API_KEY=%s\n' "$TOKEN"
echo "Save the line above: rerunning this script rotates the key." >&2
