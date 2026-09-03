# Self-hosting atmobb

The setup I support is one Linux host running:

- Postgres and the official Happyview image in Docker Compose;
- the built atmobb app under systemd;
- Caddy terminating TLS for the app and Happyview.

The installer turns that into one command. It generates the secrets, resolves both atproto accounts, starts and configures Happyview, builds the app, writes the systemd unit, and adds the two Caddy sites. Rerunning it is safe. It keeps existing secrets and the Happyview operator key.

The examples use `forum.example.net` for the app, `hv.forum.example.net` for Happyview, and `/srv/atmobb` for the checkout. Replace them with your own values.

## Before you start

You need:

- an x86-64 or arm64 Linux server with `sudo` and inbound ports 80 and 443;
- Docker Engine and Docker Compose 2.20+;
- Bun 1.4+, system-wide Node.js 22.19+, `git`, `curl` 7.76+, `jq`, and `openssl`;
- Caddy installed as a systemd service;
- DNS `A`/`AAAA` records for both hostnames pointing to the server;
- enough disk for Postgres data and off-server backups.

You also need two atproto accounts:

1. **Your personal account**, which becomes the first forum admin.
2. **A new, dedicated forum account**, which owns the forum profile, boards, staff grants, and moderation history. A bsky.social account is fine.

> [!IMPORTANT]
> Do not use your personal account as the forum identity. Moving the forum to another account later means migrating everything it owns. Put the dedicated account's credentials in a password manager; the installer never asks for or stores its password.

The `app.atmobb.*` lexicons are already published. You don't publish schemas or configure lexicon DNS.

## 1. Install

Clone the repository:

```sh
sudo git clone https://github.com/keithk/atmoBB.git /srv/atmobb
sudo chown -R "$USER":"$USER" /srv/atmobb
cd /srv/atmobb
```

Run the installer as your normal login user:

```sh
./infra/install-self-host.sh \
  --app-host forum.example.net \
  --admin-handle alice.bsky.social \
  --forum-handle my-forum.bsky.social
```

Happyview defaults to `hv.<app-host>`. Use `--happyview-host hv.example.net` to choose a different hostname, or run the script without arguments for interactive prompts. `--help` lists every option.

The installer will show the resolved DIDs and deployment settings before it changes anything. It then:

1. installs locked dependencies, type-checks, and builds atmobb;
2. creates root-only config under `/etc/atmobb` and OAuth storage under `/var/lib/atmobb`;
3. pulls the pinned Happyview release and starts it with Postgres;
4. creates the Happyview operator key and installs atmobb's lexicons, Lua queries, and derived tables;
5. installs and starts `atmobb.service`;
6. adds `/etc/caddy/atmobb.caddy`, imports it from the main Caddyfile, validates the combined config, and enables HTTPS.

It doesn't install operating-system packages or touch DNS. If it stops on a failed check, fix that problem and run the same command again. It keeps generated credentials instead of rotating them.

> [!NOTE]
> Happyview is pinned to `ghcr.io/gamesgamesgamesgamesgames/happyview:2.14.0`. Do not replace the pin with `latest`: upgrades can run forward-only database migrations. Back up Postgres before changing the tag.

## 2. Connect the forum account

When the installer finishes:

1. Open `https://forum.example.net` and log in with your **personal** account.
2. Go to `/admin`.
3. Enter the dedicated forum account's handle.
4. Complete OAuth as the **forum account**, not your personal account. The consent screen asks for `app.atmobb.authSysop`.
5. Create the forum profile and first board in `/admin`.

The app stores the forum account's OAuth session under `/var/lib/atmobb/oauth` and writes an admin grant for your personal DID into the forum account's repo. Your browser remains logged in as your personal account.

> [!WARNING]
> Protect the forum account and `/var/lib/atmobb/oauth`. Either one can authorize writes to the forum repo.

## 3. Backfill existing public records

Happyview receives live events from Jetstream, not history. Run a backfill after setup and after an outage that may have dropped events. First set these shortcuts in your shell:

```sh
cd /srv/atmobb
COMPOSE="sudo docker compose --project-name atmobb --env-file /etc/atmobb/appview.env -f /srv/atmobb/infra/appview-compose.example.yml"
PG_EXEC="$COMPOSE exec -T postgres"
FORUM_DID="$(sudo sed -n 's/^ATMOBB_FORUM_DID=//p' /etc/atmobb/app.env)"
```

Then start the backfill:

```sh
HAPPYVIEW_API_KEY="$(sudo sed -n 's/^HAPPYVIEW_API_KEY=//p' /etc/atmobb/happyview-admin.env)" \
  HV=http://127.0.0.1:3000 PG_EXEC="$PG_EXEC" sh appview/backfill.sh
```

It backfills every record collection, waits for completion, then rebuilds counts and moderation state. It can use substantial CPU, network, and database capacity. Permissioned-space content is local and is never backfilled from the network.

## 4. Enable private boards (optional)

> [!CAUTION]
> Happyview permissioned spaces are experimental and off by default. Private-board content lives only in your Postgres volume. It is not in anyone's atproto repo and cannot be recovered by backfill. Set up and test off-server backups first.

Once backups work, enable spaces over the loopback-only admin API:

```sh
HAPPYVIEW_API_KEY="$(sudo sed -n 's/^HAPPYVIEW_API_KEY=//p' /etc/atmobb/happyview-admin.env)"
curl --fail-with-body --silent --show-error -X PUT \
  http://127.0.0.1:3000/admin/settings/feature.spaces_enabled \
  -H "Authorization: Bearer $HAPPYVIEW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"value":"true"}'
```

The installer already gives the app the matching Happyview session secret. Read [Members-only boards](private-boards.md) before creating one.

## 5. Verify

Once you have created a board:

```sh
$COMPOSE ps
sudo systemctl is-active atmobb caddy

curl --fail --silent --show-error \
  https://forum.example.net/oauth-client-metadata.json | jq '{client_id, redirect_uris}'

curl --silent --output /dev/null --write-out 'admin endpoint: %{http_code}\n' \
  https://hv.forum.example.net/admin

curl --fail --silent --show-error --get \
  --data-urlencode "forum=$FORUM_DID" \
  https://hv.forum.example.net/xrpc/app.atmobb.forum.getBoardIndex | \
  jq '.forum.name, (.boards | length)'
```

The services must be active, both OAuth URLs must use the public forum origin, the Happyview admin endpoint must return `404`, and the board query must return the forum name and at least one board.

Also test these flows in the browser:

1. Personal-account login returns to the forum and survives `sudo systemctl restart atmobb`.
2. A public thread appears after the Jetstream round trip, usually within a few seconds.
3. `/admin` opens for the personal admin and forum profile edits reach the index.
4. If private boards are enabled, a non-member sees only the locked shell of a test board.

## HTTPS and network exposure

Caddy proxies the forum to `127.0.0.1:3001` and Happyview to `127.0.0.1:3000`. Its generated Happyview site blocks `/admin` from the public internet; operator scripts use that API over loopback instead. Postgres is not published on the host.

If you replace Caddy, preserve the original host and protocol headers, keep both application ports on loopback, and block `/admin` and `/admin/*` on the public Happyview hostname.

## Operations

The commands below assume `COMPOSE` and `PG_EXEC` are set as shown in step 3.

### Logs

```sh
sudo journalctl -u atmobb -n 200 --no-pager
$COMPOSE logs --tail=200 happyview postgres
```

### Backups

Back up Postgres, OAuth state, and configuration:

```sh
umask 077
BACKUP_DIR="$HOME/atmobb-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
$COMPOSE exec -T postgres pg_dump -Fc -U happyview -d happyview > "$BACKUP_DIR/postgres.dump"
sudo tar -C /var/lib/atmobb -czf - oauth > "$BACKUP_DIR/oauth.tar.gz"
sudo tar -C /etc -czf - atmobb > "$BACKUP_DIR/config.tar.gz"
ls -lh "$BACKUP_DIR"
```

> [!WARNING]
> These archives contain credentials and private data. Copy them off the server, restrict access, and test a restore. Public records can be backfilled; derived statistics, Happyview configuration and keys, private-board content, and OAuth sessions cannot.

### Upgrades

Verify a backup, update the checkout, then rerun the installer with the same arguments:

```sh
cd /srv/atmobb
git pull --ff-only
./infra/install-self-host.sh \
  --app-host forum.example.net \
  --admin-handle alice.bsky.social \
  --forum-handle my-forum.bsky.social \
  --yes
```

This rebuilds the app, pulls the pinned images, reruns the idempotent Happyview setup, and restarts the services without rotating credentials. If an update changes the Happyview image tag, read its release notes and verify the database backup before running this.

### Configuration and secrets

| path | contents |
|---|---|
| `/etc/atmobb/app.env` | App origin, forum DID, cookie secret, and Happyview session secret. |
| `/etc/atmobb/appview.env` | Postgres and Happyview secrets. |
| `/etc/atmobb/happyview-admin.env` | Operator key used only by setup and backfill scripts. |
| `/var/lib/atmobb/oauth` | Persistent user and forum OAuth sessions. |
| `/etc/caddy/atmobb.caddy` | Generated public routes. |

Keep `HAPPYVIEW_API_KEY` out of `app.env`. The web app never needs this operator credential.

Relevant app environment variables:

| variable | purpose |
|---|---|
| `ORIGIN` / `ATMOBB_APP_URL` | Exact public HTTPS app origin, without a trailing slash. |
| `HAPPYVIEW_URL` | Public Happyview base URL. |
| `ATMOBB_FORUM_DID` | DID of the dedicated forum account. |
| `ATMOBB_COOKIE_SECRET` | Signs app login cookies; rotating it logs everyone out. |
| `DATA_DIR` | Persistent OAuth state; losing it disconnects every account. |
| `HAPPYVIEW_SESSION_SECRET` | Copy of Happyview's session secret for private boards. Must be at least 32 bytes; in production the app refuses to start with a weak one, and treats a weak `ATMOBB_COOKIE_SECRET` the same way. |
| `HAPPYVIEW_CLIENT_KEY` | Optional app identity for Happyview rate limiting. |
| `ATMOBB_AVATAR_BUILDER_URL` | Optional. Links an external avatar builder from profile settings. |

Rotating the Happyview session secret requires changing both environment files and restarting Happyview and atmobb. Rotating the Postgres password requires changing the database role and its environment together; editing only the env file locks Happyview out.

### Common failures

| symptom | check |
|---|---|
| Installer says Node is not executable by `atmobb` | Install Node system-wide rather than under a home-directory version manager. |
| Caddy cannot obtain certificates | Confirm both DNS records reach this host and ports 80/443 are open. |
| Login or form POST fails | `ORIGIN` and `ATMOBB_APP_URL` must equal the public HTTPS forum URL, without a trailing slash. |
| OAuth metadata uses the wrong host | Check `/etc/atmobb/app.env`, restart atmobb, then fetch `/oauth-client-metadata.json` again. |
| App shows “appview down” | Check Caddy, run `curl http://127.0.0.1:3000` on the host, and inspect Happyview logs. |
| Forum edits fail after restart | Confirm `/var/lib/atmobb/oauth` exists and is writable by `atmobb`, then reconnect at `/admin/connect`. |
| Private board operations return 401/403 | Confirm spaces are enabled and both services use exactly the same session secret. |
| Counts are missing | Run the backfill in step 3 and let it finish. |
| Backfill reports `too many clients` | Keep the checked-in Postgres `max_connections=200`; external Postgres needs equivalent capacity. |
