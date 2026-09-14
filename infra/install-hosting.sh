#!/bin/sh
# Opt-in host setup, run by the infrastructure operator, never by the web app.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Run as root.' >&2; exit 1; }
[ "$#" -eq 2 ] || { echo 'Usage: sudo sh infra/install-hosting.sh DOMAIN TRUSTED_RELEASE_BUNDLE' >&2; exit 1; }
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for command in python3 docker caddy systemctl sudo curl jq openssl; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done
grep -q '^# ATMOBB_INSTANCE_CONFIG_VERSION=1$' "$2/atmobb"
grep -q '^# ATMOBB_INSTANCE_CONFIG_VERSION=1$' "$2/compose.yml"
grep -Fxq 'import /etc/caddy/atmobb-hosting/*.caddy' /etc/caddy/Caddyfile || {
  echo 'First add: import /etc/caddy/atmobb-hosting/*.caddy to the host Caddyfile. See docs/hosted-tenants.md.' >&2
  exit 1
}
install -d -m 755 /usr/local/lib/atmobb-hosting /etc/atmobb /etc/caddy/atmobb-hosting
install -d -m 700 /var/lib/atmobb-hosting /var/lib/atmobb-hosting/template
install -m 755 "$source_dir/hosting.py" /usr/local/lib/atmobb-hosting/hosting.py
# Do not import an installation's .env or mutable storage into the template.
for file in atmobb updater.py compose.yml compose.caddy.yml Caddyfile env.example; do
  install -m 755 "$2/$file" "/var/lib/atmobb-hosting/template/$file"
done
python3 - "$1" <<'PY'
import json, os, secrets, sys
from pathlib import Path
sys.path.insert(0, '/usr/local/lib/atmobb-hosting')
from hosting import hostname
os.umask(0o077)
domain = sys.argv[1]
if not hostname(domain):
    raise SystemExit('Invalid domain; use lowercase DNS syntax.')
path = Path('/etc/atmobb/hosting.json')
if path.exists():
    value = json.loads(path.read_text())
    if value['domain'] != domain:
        raise SystemExit('Existing hosting domain differs; migrate deliberately.')
else:
    value = dict(domain=domain, firstPort=12000, token=secrets.token_hex(32),
                 template='/var/lib/atmobb-hosting/template', routes='/etc/caddy/atmobb-hosting')
    path.write_text(json.dumps(value, indent=2) + '\n')
state = Path('/var/lib/atmobb-hosting/state.json')
if not state.exists():
    if any(Path('/var/lib/atmobb-hosting/instances').glob('*')):
        raise SystemExit('Missing state with existing instances: restore state before continuing.')
    state.write_text(json.dumps(dict(limit=0, instances=[])) + '\n')
Path('/etc/atmobb/hosting-app.env').write_text(
    f"ATMOBB_HOSTING_TOKEN={value['token']}\nATMOBB_HOSTING_DOMAIN_SUFFIX={domain}\n")
PY
cat > /etc/systemd/system/atmobb-hosting.service <<'UNIT'
[Unit]
Description=atmobb isolated hosting controller
Wants=network-online.target
After=network-online.target docker.service caddy.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/lib/atmobb-hosting/hosting.py
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now atmobb-hosting
systemctl restart atmobb-hosting
echo 'Hosting installed with capacity zero. Wire the operator forum using /etc/atmobb/hosting-app.env and compose.hosting.yml; see docs/hosted-tenants.md.'
