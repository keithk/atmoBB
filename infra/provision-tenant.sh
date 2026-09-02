#!/bin/sh
# Provision a hosted atmobb tenant on the deploy dashboard.
#
#   DEPLOY_SESSION_TOKEN=... sh infra/provision-tenant.sh <site-name> <forum-handle>
#
# <site-name>    dashboard site name; the site serves https://<site-name>.atmobb.app
# <forum-handle> the tenant's dedicated forum account (they bring their own)
#
# What a hosted tenant gets: a vanilla build of this repo,
# pointed at the shared appview, with no private boards (no session secret)
# and its own Happyview client key for rate limiting. See
# docs/hosted-tenants.md for the full runbook and the manual steps after.
#
# Needs: curl, jq, openssl, ssh access to the droplet, and a dashboard
# session token in DEPLOY_SESSION_TOKEN.
set -eu

SITE=${1:?usage: provision-tenant.sh <site-name> <forum-handle>}
FORUM_HANDLE=${2:?usage: provision-tenant.sh <site-name> <forum-handle>}

DEPLOY_API=${DEPLOY_API:-https://admin.keith.is}
DROPLET=${DROPLET:-root@admin.keith.is}
HV_LOOPBACK=${HV_LOOPBACK:-http://127.0.0.1:8004}
GIT_URL=${GIT_URL:-https://github.com/keithk/atmoBB.git}
HAPPYVIEW_URL=${HAPPYVIEW_URL:-https://hv.atmobb.app}
SITE_DOMAIN=${SITE_DOMAIN:-$SITE.atmobb.app}
: "${DEPLOY_SESSION_TOKEN:?set DEPLOY_SESSION_TOKEN (dashboard session token)}"

api() {
  method=$1; path=$2; shift 2
  curl --fail-with-body --silent --show-error -X "$method" \
    -H "Cookie: session=$DEPLOY_SESSION_TOKEN" \
    -H "Content-Type: application/json" \
    "$DEPLOY_API$path" "$@"
}

echo "== resolving $FORUM_HANDLE"
FORUM_DID=$(curl --fail --silent --show-error --get \
  --data-urlencode "handle=$FORUM_HANDLE" \
  https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle | jq -er .did)
echo "   $FORUM_DID"

echo "== creating site $SITE"
SITE_ID=$(api POST /api/sites -d "$(jq -n --arg name "$SITE" --arg git "$GIT_URL" \
  '{name: $name, git_url: $git, sleep_enabled: true, sleep_after_minutes: 60}')" | jq -er .id)
echo "   $SITE_ID"

echo "== public visibility, persistent storage, custom domain"
api PATCH "/api/sites/$SITE_ID" -d "$(jq -n --arg d "$SITE_DOMAIN" \
  '{visibility: "public", persistent_storage: true, custom_domains: [$d]}')" > /dev/null

echo "== minting Happyview client key"
CLIENT=$(ssh -o BatchMode=yes "$DROPLET" "KEY=\"\$(sed -n 's/^HAPPYVIEW_API_KEY=//p' /etc/atmobb/happyview-admin.env)\" && \
  curl --fail-with-body --silent --show-error -X POST \
    -H \"Authorization: Bearer \$KEY\" -H 'Content-Type: application/json' \
    $HV_LOOPBACK/admin/api-clients -d '{
      \"name\": \"$SITE\",
      \"client_id_url\": \"https://$SITE_DOMAIN/oauth-client-metadata.json\",
      \"client_uri\": \"https://$SITE_DOMAIN\",
      \"redirect_uris\": [\"https://$SITE_DOMAIN/oauth/callback\"]
    }'")
CLIENT_KEY=$(printf '%s' "$CLIENT" | jq -er .client_key)
CLIENT_SECRET=$(printf '%s' "$CLIENT" | jq -er .client_secret)

echo "== environment"
api PATCH "/api/sites/$SITE_ID/env" -d "$(jq -n \
  --arg origin "https://$SITE_DOMAIN" \
  --arg hv "$HAPPYVIEW_URL" \
  --arg did "$FORUM_DID" \
  --arg cookie "$(openssl rand -hex 32)" \
  --arg ck "$CLIENT_KEY" \
  --arg cs "$CLIENT_SECRET" \
  '{ORIGIN: $origin, ATMOBB_APP_URL: $origin, HAPPYVIEW_URL: $hv,
    ATMOBB_FORUM_DID: $did, ATMOBB_COOKIE_SECRET: $cookie,
    HAPPYVIEW_CLIENT_KEY: $ck, HAPPYVIEW_CLIENT_SECRET: $cs}')" > /dev/null

echo "== deploying"
api POST "/api/sites/$SITE_ID/deploy" > /dev/null

printf '== waiting for https://%s ' "$SITE_DOMAIN"
tries=0
until [ "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --max-time 5 "https://$SITE_DOMAIN/.well-known/atproto-did" 2>/dev/null)" = 200 ]; do
  tries=$((tries + 1))
  [ "$tries" -gt 60 ] && { echo; echo "!! site did not come up; check dashboard build logs"; exit 1; }
  printf .
  sleep 5
done
echo " up"

SERVED_DID=$(curl --fail --silent "https://$SITE_DOMAIN/.well-known/atproto-did")
[ "$SERVED_DID" = "$FORUM_DID" ] || { echo "!! well-known serves $SERVED_DID, expected $FORUM_DID"; exit 1; }

cat <<EOF

== done: https://$SITE_DOMAIN is live

Hand the tenant this checklist:
 1. Log in at https://$SITE_DOMAIN with your personal account.
 2. Open /admin and connect the forum account ($FORUM_HANDLE) via OAuth.
 3. Change the forum account's handle to $SITE_DOMAIN. The site already
    serves the DID at /.well-known/atproto-did, so HTTP verification works.
 4. Create boards, name the forum, theme it under Admin → Appearance.

Hosted tenants have no members-only boards, by design.
EOF
