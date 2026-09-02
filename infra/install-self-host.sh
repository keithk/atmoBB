#!/bin/sh
# Install a single-host atmobb deployment. This script is intentionally
# rerunnable: it preserves existing secrets and the Happyview operator key.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(dirname "$SCRIPT_DIR")
APP_HOST=
HAPPYVIEW_HOST=
ADMIN_HANDLE=
FORUM_HANDLE=
ASSUME_YES=0

usage() {
  cat <<'EOF'
Usage: infra/install-self-host.sh [options]

Required (prompted for when omitted):
  --app-host HOST          Public forum hostname, e.g. forum.example.net
  --admin-handle HANDLE    Personal atproto account for the first admin
  --forum-handle HANDLE    Dedicated atproto account owned by the forum

Optional:
  --happyview-host HOST    Happyview hostname (default: hv.APP_HOST)
  --yes                    Skip the confirmation prompt
  -h, --help               Show this help

Run this as your normal login user from the repository checkout. The script
uses sudo only for system configuration and Docker.
EOF
}

die() {
  echo "install-self-host: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-host)
      [ "$#" -ge 2 ] || die "--app-host needs a value"
      APP_HOST=$2
      shift 2
      ;;
    --happyview-host)
      [ "$#" -ge 2 ] || die "--happyview-host needs a value"
      HAPPYVIEW_HOST=$2
      shift 2
      ;;
    --admin-handle)
      [ "$#" -ge 2 ] || die "--admin-handle needs a value"
      ADMIN_HANDLE=$2
      shift 2
      ;;
    --forum-handle)
      [ "$#" -ge 2 ] || die "--forum-handle needs a value"
      FORUM_HANDLE=$2
      shift 2
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (try --help)"
      ;;
  esac
done

prompt() {
  label=$1
  value=$2
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return
  fi
  [ -t 0 ] || die "$label is required in non-interactive mode"
  printf '%s: ' "$label" >&2
  IFS= read -r value
  [ -n "$value" ] || die "$label cannot be empty"
  printf '%s' "$value"
}

APP_HOST=$(prompt "Public forum hostname" "$APP_HOST")
ADMIN_HANDLE=$(prompt "Personal admin handle" "$ADMIN_HANDLE")
FORUM_HANDLE=$(prompt "Dedicated forum handle" "$FORUM_HANDLE")
HAPPYVIEW_HOST=${HAPPYVIEW_HOST:-hv.$APP_HOST}

valid_hostname() {
  hostname=$1
  case "$hostname" in
    *[!a-z0-9.-]*|.*|*.|*..*|'') return 1 ;;
  esac
  [ "${#hostname}" -le 253 ] || return 1
  old_ifs=$IFS
  IFS=.
  set -- $hostname
  IFS=$old_ifs
  [ "$#" -ge 2 ] || return 1
  for label do
    [ "${#label}" -le 63 ] || return 1
    case "$label" in
      -*|*-|'') return 1 ;;
    esac
  done
}

valid_hostname "$APP_HOST" || die "invalid app hostname: $APP_HOST (use lowercase DNS syntax)"
valid_hostname "$HAPPYVIEW_HOST" || die "invalid Happyview hostname: $HAPPYVIEW_HOST (use lowercase DNS syntax)"
[ "$APP_HOST" != "$HAPPYVIEW_HOST" ] || die "the app and Happyview need different hostnames"

case "$REPO_DIR" in
  *[!A-Za-z0-9_./-]*) die "the repository path cannot contain spaces or shell metacharacters: $REPO_DIR" ;;
esac

for command in bun caddy curl docker git jq node openssl sudo systemctl; do
  command -v "$command" >/dev/null 2>&1 || die "$command is required"
done
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)' ||
  die "Node.js 22.19 or newer is required"
bun -e 'const [major, minor] = process.versions.bun.split(".").map(Number); process.exit(major > 1 || (major === 1 && minor >= 4) ? 0 : 1)' ||
  die "Bun 1.4 or newer is required"
curl --help all | grep -q -- '--fail-with-body' || die "curl 7.76 or newer is required"
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null) || die "Docker Compose v2.20 or newer is required"
COMPOSE_VERSION=${COMPOSE_VERSION#v}
COMPOSE_VERSION="$COMPOSE_VERSION" node -e 'const [major, minor] = process.env.COMPOSE_VERSION.split(".").map(Number); process.exit(major > 2 || (major === 2 && minor >= 20) ? 0 : 1)' ||
  die "Docker Compose v2.20 or newer is required"
sudo -v
sudo docker info >/dev/null 2>&1 || die "Docker is not running or is unavailable through sudo"
sudo systemctl cat caddy >/dev/null 2>&1 || die "the Caddy systemd service is not installed"

resolve_handle() {
  handle=$1
  did=$(curl --fail --silent --show-error --get \
    --data-urlencode "handle=$handle" \
    https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle |
    jq -er .did) || die "could not resolve atproto handle: $handle"
  printf '%s\n' "$did" | grep -Eq '^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$' ||
    die "$handle resolved to an invalid DID"
  printf '%s' "$did"
}

echo "== resolving atproto accounts"
ADMIN_DID=$(resolve_handle "$ADMIN_HANDLE")
FORUM_DID=$(resolve_handle "$FORUM_HANDLE")
[ "$ADMIN_DID" != "$FORUM_DID" ] ||
  die "the forum must use a dedicated account, not the personal admin account"

cat <<EOF

atmobb will install from: $REPO_DIR
Forum:                   https://$APP_HOST
Happyview:               https://$HAPPYVIEW_HOST
First admin:             $ADMIN_HANDLE ($ADMIN_DID)
Forum identity:          $FORUM_HANDLE ($FORUM_DID)

DNS for both hostnames must point here, and inbound ports 80/443 must be open.
Existing atmobb secrets and the Happyview operator key will be preserved.
EOF

if [ "$ASSUME_YES" -ne 1 ]; then
  printf '\nContinue? [y/N] '
  IFS= read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "Cancelled."; exit 0 ;;
  esac
fi

echo "== checking and building atmobb"
(
  cd "$REPO_DIR"
  bun install --frozen-lockfile
  bun run check
  bun run build
)

NODE_BIN=$(command -v node)
case "$NODE_BIN" in
  *[!A-Za-z0-9_./-]*) die "the Node path cannot contain spaces or shell metacharacters: $NODE_BIN" ;;
esac

sudo install -d -o root -g root -m 700 /etc/atmobb
if ! id atmobb >/dev/null 2>&1; then
  sudo useradd --system --home-dir /var/lib/atmobb --create-home --shell /usr/sbin/nologin atmobb
fi
sudo install -d -o atmobb -g atmobb -m 700 /var/lib/atmobb/oauth
sudo -u atmobb "$NODE_BIN" --version >/dev/null 2>&1 ||
  die "$NODE_BIN is not executable by the atmobb service account; install Node system-wide"
sudo -u atmobb test -r "$REPO_DIR/build/index.js" ||
  die "$REPO_DIR is not readable by the atmobb service account; install from a system path such as /srv/atmobb"

root_value() {
  file=$1
  key=$2
  sudo sed -n "s/^$key=//p" "$file" | tail -n 1
}

install_root_file() {
  source=$1
  destination=$2
  mode=${3:-600}
  sudo install -o root -g root -m "$mode" "$source" "$destination"
}

APPVIEW_ENV=/etc/atmobb/appview.env
if sudo test -f "$APPVIEW_ENV"; then
  existing_url=$(root_value "$APPVIEW_ENV" HAPPYVIEW_PUBLIC_URL)
  [ "$existing_url" = "https://$HAPPYVIEW_HOST" ] ||
    die "$APPVIEW_ENV belongs to $existing_url, not https://$HAPPYVIEW_HOST"
  SESSION_SECRET=$(root_value "$APPVIEW_ENV" SESSION_SECRET)
  [ -n "$(root_value "$APPVIEW_ENV" POSTGRES_PASSWORD)" ] || die "$APPVIEW_ENV is missing POSTGRES_PASSWORD"
  [ -n "$SESSION_SECRET" ] || die "$APPVIEW_ENV is missing SESSION_SECRET"
  [ -n "$(root_value "$APPVIEW_ENV" TOKEN_ENCRYPTION_KEY)" ] || die "$APPVIEW_ENV is missing TOKEN_ENCRYPTION_KEY"
  echo "== preserving existing Happyview secrets"
else
  if sudo docker volume inspect atmobb_pgdata >/dev/null 2>&1; then
    die "$APPVIEW_ENV is missing but the atmobb database already exists; restore the env file from backup"
  fi
  appview_tmp=$(mktemp)
  trap 'rm -f "$appview_tmp"' EXIT HUP INT TERM
  umask 077
  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  SESSION_SECRET=$(openssl rand -hex 32)
  TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
  cat > "$appview_tmp" <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
SESSION_SECRET=$SESSION_SECRET
TOKEN_ENCRYPTION_KEY=$TOKEN_ENCRYPTION_KEY
HAPPYVIEW_PUBLIC_URL=https://$HAPPYVIEW_HOST
EOF
  install_root_file "$appview_tmp" "$APPVIEW_ENV"
  rm -f "$appview_tmp"
  trap - EXIT HUP INT TERM
  echo "== generated Happyview secrets"
fi

COMPOSE_FILE=$REPO_DIR/infra/appview-compose.example.yml
compose() {
  sudo docker compose --project-name atmobb --env-file "$APPVIEW_ENV" -f "$COMPOSE_FILE" "$@"
}
PG_EXEC="sudo docker compose --project-name atmobb --env-file $APPVIEW_ENV -f $COMPOSE_FILE exec -T postgres"

echo "== starting Postgres and Happyview"
compose config --quiet
compose pull
compose up -d
compose ps

ADMIN_KEY_ENV=/etc/atmobb/happyview-admin.env
if sudo test -f "$ADMIN_KEY_ENV"; then
  echo "== preserving existing Happyview operator key"
else
  key_tmp=$(mktemp)
  trap 'rm -f "$key_tmp"' EXIT HUP INT TERM
  if ! ADMIN_DID="$ADMIN_DID" PG_EXEC="$PG_EXEC" sh "$REPO_DIR/appview/bootstrap-admin.sh" > "$key_tmp"; then
    die "Happyview bootstrap failed; inspect the container logs and rerun this installer"
  fi
  install_root_file "$key_tmp" "$ADMIN_KEY_ENV"
  rm -f "$key_tmp"
  trap - EXIT HUP INT TERM
fi

HAPPYVIEW_API_KEY=$(root_value "$ADMIN_KEY_ENV" HAPPYVIEW_API_KEY)
[ -n "$HAPPYVIEW_API_KEY" ] || die "$ADMIN_KEY_ENV is missing HAPPYVIEW_API_KEY"
echo "== configuring Happyview"
HAPPYVIEW_API_KEY="$HAPPYVIEW_API_KEY" HV=http://127.0.0.1:3000 PG_EXEC="$PG_EXEC" \
  sh "$REPO_DIR/appview/setup.sh"

APP_ENV=/etc/atmobb/app.env
if sudo test -f "$APP_ENV"; then
  [ "$(root_value "$APP_ENV" ORIGIN)" = "https://$APP_HOST" ] ||
    die "$APP_ENV is configured for a different app hostname"
  [ "$(root_value "$APP_ENV" ATMOBB_APP_URL)" = "https://$APP_HOST" ] ||
    die "$APP_ENV has the wrong ATMOBB_APP_URL"
  [ "$(root_value "$APP_ENV" HAPPYVIEW_URL)" = "https://$HAPPYVIEW_HOST" ] ||
    die "$APP_ENV is configured for a different Happyview hostname"
  [ "$(root_value "$APP_ENV" ATMOBB_FORUM_DID)" = "$FORUM_DID" ] ||
    die "$APP_ENV is configured for a different forum identity"
  [ -n "$(root_value "$APP_ENV" ATMOBB_COOKIE_SECRET)" ] || die "$APP_ENV is missing ATMOBB_COOKIE_SECRET"
  [ "$(root_value "$APP_ENV" HAPPYVIEW_SESSION_SECRET)" = "$SESSION_SECRET" ] ||
    die "$APP_ENV and $APPVIEW_ENV have different Happyview session secrets"
  echo "== preserving existing app secrets"
else
  app_tmp=$(mktemp)
  trap 'rm -f "$app_tmp"' EXIT HUP INT TERM
  umask 077
  COOKIE_SECRET=$(openssl rand -hex 32)
  cat > "$app_tmp" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
BODY_SIZE_LIMIT=3M
ORIGIN=https://$APP_HOST
ATMOBB_APP_URL=https://$APP_HOST
HAPPYVIEW_URL=https://$HAPPYVIEW_HOST
ATMOBB_FORUM_DID=$FORUM_DID
ATMOBB_COOKIE_SECRET=$COOKIE_SECRET
DATA_DIR=/var/lib/atmobb/oauth
HAPPYVIEW_SESSION_SECRET=$SESSION_SECRET
EOF
  install_root_file "$app_tmp" "$APP_ENV"
  rm -f "$app_tmp"
  trap - EXIT HUP INT TERM
  echo "== generated app secrets"
fi

unit_tmp=$(mktemp)
trap 'rm -f "$unit_tmp"' EXIT HUP INT TERM
cat > "$unit_tmp" <<EOF
[Unit]
Description=atmobb forum
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=atmobb
Group=atmobb
WorkingDirectory=$REPO_DIR
EnvironmentFile=$APP_ENV
ExecStart=$NODE_BIN build
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
install_root_file "$unit_tmp" /etc/systemd/system/atmobb.service 644
rm -f "$unit_tmp"
trap - EXIT HUP INT TERM

echo "== starting atmobb"
sudo systemctl daemon-reload
sudo systemctl enable --now atmobb
sudo systemctl restart atmobb
sudo systemctl is-active --quiet atmobb || die "atmobb did not start; run: sudo journalctl -u atmobb -n 100"

CADDY_MAIN=/etc/caddy/Caddyfile
CADDY_SITE=/etc/caddy/atmobb.caddy
sudo test -f "$CADDY_MAIN" || die "$CADDY_MAIN does not exist"
caddy_tmp=$(mktemp)
caddy_main_backup=$(mktemp)
caddy_site_backup=$(mktemp)
trap 'rm -f "$caddy_tmp" "$caddy_main_backup" "$caddy_site_backup"' EXIT HUP INT TERM
sudo cat "$CADDY_MAIN" > "$caddy_main_backup"
caddy_site_existed=0
if sudo test -f "$CADDY_SITE"; then
  sudo cat "$CADDY_SITE" > "$caddy_site_backup"
  caddy_site_existed=1
fi
cat > "$caddy_tmp" <<EOF
$APP_HOST {
	reverse_proxy 127.0.0.1:3001
}

$HAPPYVIEW_HOST {
	@admin path /admin /admin/*
	respond @admin 404
	reverse_proxy 127.0.0.1:3000
}
EOF
install_root_file "$caddy_tmp" "$CADDY_SITE" 644
if ! sudo grep -Fqx "import $CADDY_SITE" "$CADDY_MAIN"; then
  {
    cat "$caddy_main_backup"
    printf '\nimport %s\n' "$CADDY_SITE"
  } > "$caddy_tmp"
  install_root_file "$caddy_tmp" "$CADDY_MAIN" 644
fi
if ! sudo caddy validate --config "$CADDY_MAIN"; then
  install_root_file "$caddy_main_backup" "$CADDY_MAIN" 644
  if [ "$caddy_site_existed" -eq 1 ]; then
    install_root_file "$caddy_site_backup" "$CADDY_SITE" 644
  else
    sudo rm -f "$CADDY_SITE"
  fi
  die "Caddy rejected the generated sites; its previous configuration was restored"
fi
rm -f "$caddy_tmp" "$caddy_main_backup" "$caddy_site_backup"
trap - EXIT HUP INT TERM

echo "== enabling HTTPS"
sudo systemctl enable --now caddy
sudo systemctl reload caddy

cat <<EOF

Installation complete.

1. Open https://$APP_HOST and log in with $ADMIN_HANDLE.
2. Open https://$APP_HOST/admin and connect $FORUM_HANDLE when prompted.
3. Create the forum profile and first board in /admin.

Caddy may take a moment to obtain certificates after DNS reaches this host.
The operator key is in $ADMIN_KEY_ENV; it is not exposed to the web app.
EOF
