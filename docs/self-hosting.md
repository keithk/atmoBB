# Self-hosting atmobb

The setup I support is one Linux host running Postgres, the official Happyview image, and the atmobb app. There are two ways to get there:

- **The prebuilt release** (recommended). Run the one-line installer, or download its versioned bundle by hand, and everything runs as pinned container images under Docker Compose. Caddy is either bundled or your own reverse proxy. Stable versions need no build tools or source checkout. An admin can also explicitly choose to build an exact, unreleased `main` commit on this host.
- **From source.** Clone the repository and run `infra/install-self-host.sh`, which builds the app on the server and runs it under systemd behind a host-installed Caddy. Use this if you're developing or changing how the services are installed.

Both are rerunnable and keep existing secrets and the Happyview operator key. Both leave the same things on disk: Postgres data, OAuth state in `/var/lib/atmobb/oauth`, and a few env files. You can move from one to the other by pointing the new install at the same directory.

The examples use `forum.example.net` for the app and `hv.forum.example.net` for Happyview. Replace them with your own values.

## Before you start

You need:

- an x86-64 or arm64 Linux server with `sudo` and inbound ports 80 and 443;
- Docker Engine and Docker Compose 2.20+;
- `curl` 7.76+, `jq`, and `openssl`;
- DNS `A`/`AAAA` records for both hostnames pointing to the server;
- enough disk for Postgres data and off-server backups.

Building from source additionally needs Bun 1.4+, system-wide Node.js 22.19+, `git`, and Caddy installed as a systemd service.

You also need two atproto accounts:

1. **Your personal account**, which becomes the first forum admin.
2. **A new, dedicated forum account**, which owns the forum profile, boards, staff grants, and moderation history. A bsky.social account is fine.

> [!IMPORTANT]
> Do not use your personal account as the forum identity. Moving the forum to another account later means migrating everything it owns. Put the dedicated account's credentials in a password manager; the installer never asks for or stores its password.

The `app.atmobb.*` lexicons are already published. You don't publish schemas or configure lexicon DNS.

## 1. Install

### One-line install (recommended)

On a fresh host, run this as your normal login user:

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/keithk/atmoBB/main/install.sh | sh
```

The script finds the latest GitHub release, verifies the bundle against its published SHA-256 checksum, unpacks it into `/srv/atmobb`, and starts the interactive installer with the bundled Caddy HTTPS proxy. It asks for the forum hostname, your personal admin handle, and the dedicated forum handle, then shows the complete plan before changing service configuration or starting containers. Do not prefix the command with `sudo`; the installer asks for `sudo` only when it needs to create system directories or run Docker.

If you prefer to inspect scripts before running them, download it first:

```sh
curl --proto '=https' --tlsv1.2 -fsSLO https://raw.githubusercontent.com/keithk/atmoBB/main/install.sh
less install.sh
sh install.sh
```

Use the manual bundle installation below if you already have a reverse proxy, want the files somewhere other than `/srv/atmobb`, or want to verify and unpack every artifact yourself.

### Manual release install

Download the latest `atmobb-X.Y.Z.tar.gz` from the [releases page](https://github.com/keithk/atmoBB/releases), check it against `SHA256SUMS`, and unpack it somewhere permanent:

```sh
sudo mkdir -p /srv/atmobb && sudo chown "$USER":"$USER" /srv/atmobb
tar -xzf atmobb-X.Y.Z.tar.gz --strip-components=1 -C /srv/atmobb
cd /srv/atmobb
```

The bundle holds `compose.yml`, the optional `compose.caddy.yml` overlay and its `Caddyfile`, `env.example`, the `./atmobb` operator script, and the restricted updater service. Run the installer as your normal login user:

```sh
./atmobb install \
  --app-host forum.example.net \
  --admin-handle alice.bsky.social \
  --forum-handle my-forum.bsky.social \
  --caddy
```

`--caddy` runs the bundled Caddy on ports 80 and 443 and gives you HTTPS with nothing else to configure. Leave it off if the host already runs a reverse proxy; the forum then listens on `127.0.0.1:3001` and Happyview on `127.0.0.1:3000`, and you add the two sites yourself (see [HTTPS and network exposure](#https-and-network-exposure)). Happyview's hostname defaults to `hv.<app-host>`; `--happyview-host` changes it. Without arguments the script prompts.

It shows the resolved DIDs and settings before changing anything, then:

1. writes `.env` (mode 600) with generated secrets, keeping any that already exist;
2. creates `/var/lib/atmobb/oauth` for OAuth state, owned by uid 10001, the container's `atmobb` user;
3. installs the root-owned, fixed-action `atmobb-updater` service and its authenticated Unix socket;
4. pulls the pinned images and starts Postgres and Happyview;
5. creates the Happyview operator key on first run and stores it in `.env`;
6. runs the setup job, which checks the Happyview version and installs atmobb's lexicons, Lua queries, and derived tables;
7. starts the web app, and Caddy if requested.

On an existing release-bundle installation, rerun the same `./atmobb install` command and options to install or refresh Admin → Updates. The command is rerunnable: it preserves `.env`, generated secrets, OAuth state, the Happyview operator key, and database data.

`./atmobb help` lists the other commands: `upgrade`, `upgrade-happyview`, `backfill`, `backup`, `status`, `logs`. Anything else is plain `docker compose` in that directory.

> [!NOTE]
> Both image tags in `compose.yml` are pinned by the release. Do not edit them by hand or replace them with `latest`; the setup job refuses to start the app against a Happyview version this release was not tested with. [Upgrades](#upgrades) covers moving between versions.

### From source

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

Happyview receives live events from Jetstream, not history. Run a backfill after setup and after an outage that may have dropped events.

From the release bundle:

```sh
cd /srv/atmobb
./atmobb backfill
```

From a source install, first set these shortcuts in your shell:

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

Once backups work, enable spaces over the loopback-only admin API. Read the operator key from `.env` in the bundle directory, or from `/etc/atmobb/happyview-admin.env` on a source install:

```sh
HAPPYVIEW_API_KEY="$(sed -n 's/^HAPPYVIEW_API_KEY=//p' /srv/atmobb/.env)"
curl --fail-with-body --silent --show-error -X PUT \
  http://127.0.0.1:3000/admin/settings/feature.spaces_enabled \
  -H "Authorization: Bearer $HAPPYVIEW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"value":"true"}'
```

The installer already gives the app the matching Happyview session secret. Read [Members-only boards](private-boards.md) before creating one.

## 5. Verify

Once you have created a board, check the services. From the bundle, `./atmobb status` shows container state and the running atmobb version; from source, `$COMPOSE ps` and `sudo systemctl is-active atmobb caddy`. Then, with `FORUM_DID` set to the forum account's DID:

```sh
curl --fail --silent --show-error https://forum.example.net/api/version

curl --fail --silent --show-error \
  https://forum.example.net/oauth-client-metadata.json | jq '{client_id, redirect_uris}'

curl --silent --output /dev/null --write-out 'admin endpoint: %{http_code}\n' \
  https://hv.forum.example.net/admin

curl --fail --silent --show-error --get \
  --data-urlencode "forum=$FORUM_DID" \
  https://hv.forum.example.net/xrpc/app.atmobb.forum.getBoardIndex | \
  jq '.forum.name, (.boards | length)'
```

The services must be active, `/api/version` must report the version you installed, both OAuth URLs must use the public forum origin, the Happyview admin endpoint must return `404`, and the board query must return the forum name and at least one board.

Also test these flows in the browser:

1. Personal-account login returns to the forum and survives a restart (`docker compose restart atmobb` or `sudo systemctl restart atmobb`).
2. A public thread appears after the Jetstream round trip, usually within a few seconds.
3. `/admin` opens for the personal admin and forum profile edits reach the index.
4. If private boards are enabled, a non-member sees only the locked shell of a test board.

## HTTPS and network exposure

The forum listens on `127.0.0.1:3001` and Happyview on `127.0.0.1:3000`. Caddy, whether the bundled overlay or the host service the source installer configures, proxies both hostnames and blocks `/admin` on the Happyview hostname from the public internet; operator scripts use that API over loopback or the Compose network instead. Postgres is not published on the host.

If you run your own reverse proxy, preserve the original host and protocol headers, keep both application ports on loopback, and block `/admin` and `/admin/*` on the public Happyview hostname. The bundle's `Caddyfile` is the reference for what each site needs.

## Operations

Bundle commands run from the bundle directory. Source-install commands assume `COMPOSE` and `PG_EXEC` are set as shown in step 3.

### Logs

```sh
# bundle
./atmobb logs --tail=200 atmobb happyview

# source
sudo journalctl -u atmobb -n 200 --no-pager
$COMPOSE logs --tail=200 happyview postgres
```

### Backups

From the bundle, `./atmobb backup` writes `postgres.dump`, `oauth.tar.gz`, `.env`, `compose.yml`, and any bundled Caddy configuration to `./backups/<timestamp>/` (or a directory you pass). `./atmobb upgrade-happyview` and Admin → Updates use the same backup before migrations or activation.

From source, back up Postgres, OAuth state, and configuration by hand:

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
> These archives contain credentials and private data, including the private key the forum signs notifications with. Copy them off the server, restrict access, and test a restore. Public records can be backfilled; derived statistics, Happyview configuration and keys, private-board content, OAuth sessions, and notification state cannot. Restore the data directory and the database from the same backup: a data directory without its `notify/sender-key.json` starts the forum as a new atmo.pub sender, the app logs a warning at startup, and every member has to approve it again.

### Upgrades

Read the release notes first. Every release states the Happyview version it runs against, and a release that changes it says so on its first line. [Releasing](releasing.md) explains what patch, minor, and major mean for you.

**Admin updates for a release-bundle installation.** Open **Admin → Updates** as a forum admin and choose **update to latest stable release**. The restricted host updater:

1. resolves the latest published release, downloads its bundle and checksum, verifies the bundle, and pulls its pinned prebuilt images;
2. leaves the running containers untouched if download or pull preparation fails;
3. backs up Postgres, OAuth state, `.env`, and Compose/Caddy configuration before any migration or activation;
4. activates the prepared bundle, starts its pinned Happyview version, and waits for startup migrations;
5. force-runs the release's setup job so new lexicons, Lua queries, and derived-table setup are applied before atmobb starts;
6. starts atmobb and reports success only after its HTTP version, required containers, running image pins, and setup exit status all match.

The page shows persisted progress and the bounded update log. Its status survives the web app restarting because the updater runs separately on the host and stores state under `/var/lib/atmobb-updater`.

**Advanced: unreleased `main`.** Expand **Advanced options**, read the warning, and type `main` to confirm. This resolves the branch to a specific 40-character commit, downloads exactly that source archive, and builds `atmobb-main:<commit>` locally before touching the running stack. The installed commit remains visible in Admin → Updates. `main` is not a release: it may be broken, may contain forward-only changes, and building it can consume substantial time, memory, and disk, fail, or degrade a small VPS. Use stable unless you deliberately accept those risks.

Both admin paths move the bundled atmobb, Happyview, Postgres, setup, and optional Caddy definitions together rather than updating only the frontend. The web app can request only stable or main over an authenticated Unix socket; it does not receive the Docker socket, a shell, a selectable ref, or the Happyview operator key.

If an update fails, open its log and note whether it reports a pre-migration backup. Then inspect the host directly:

```sh
cd /srv/atmobb
./atmobb status
./atmobb logs --tail=200 postgres happyview setup atmobb
sudo journalctl -u atmobb-updater -n 200 --no-pager
```

A preparation failure occurs before activation and leaves the previous containers running. A failure after activation or a Happyview migration needs operator recovery. Happyview migrations may be forward-only, so the updater does not automatically claim or attempt rollback; preserve the backup path shown in Admin → Updates, copy it off-host, and restore the database, OAuth state, and matching saved configuration together if recovery requires a restore.

**Manual bundle update.** You can still download and unpack a new release tarball over the bundle directory (`.env` and `backups/` are yours and aren't in the tarball), then run:

```sh
cd /srv/atmobb
./atmobb upgrade
```

That pulls the new atmobb image, reruns setup, and restarts the app. If the new bundle pins a different Happyview, `upgrade` stops and tells you to run:

```sh
./atmobb upgrade-happyview
```

which takes a backup, shows the version change, asks for confirmation, recreates only Happyview, waits for its migrations to finish, then reapplies setup and restarts the app. Happyview migrations are forward-only: once they run, you cannot go back down a version, which is why the backup comes first. Afterwards `./atmobb status` shows the running version.

If you bring the stack up with a mismatched pair some other way, the setup job refuses to start the app and prints both versions. Nothing serves until you fix the pin or run `upgrade-happyview`.

**Source.** Verify a backup, update the checkout, then rerun the installer with the same arguments:

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

Bundle install:

| path | contents |
|---|---|
| `/srv/atmobb/.env` | Hostnames, forum DID, every secret, and the Happyview operator key. Only the setup job receives the operator key; the web app container never does. |
| `/srv/atmobb/compose.yml` | The pinned stack. Replaced by each release. |
| `/var/lib/atmobb/oauth` | Persistent user and forum OAuth sessions, plus `notify/` with the atmo.pub signing key and notification state, and `extensions/` with installed extensions, their release bundles, and each install's private storage. Mounted at `/data` in the app container. Owned by uid 10001. |
| `atmobb_pgdata` volume | Postgres data. |
| `/etc/atmobb/updater.env` | Root-only updater authentication and bundle location. |
| `/var/lib/atmobb-updater` | Persistent update state, bounded log, and temporary staging directories. |
| `/run/atmobb-updater/updater.sock` | Restricted fixed-action updater socket mounted into the web container; not a Docker socket. |

Source install:

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
| `ADDRESS_HEADER` / `XFF_DEPTH` | Which proxy header carries the visitor's address, for example `X-Forwarded-For` and `1` behind Caddy. Signed-out visitors' extension actions are rate-limited per address; without these, every visitor counts as the proxy's address and shares one limit. |
| `HAPPYVIEW_URL` | Public Happyview base URL. |
| `ATMOBB_FORUM_DID` | DID of the dedicated forum account. |
| `ATMOBB_COOKIE_SECRET` | Signs app login cookies; rotating it logs everyone out. |
| `ATMOBB_UPDATER_TOKEN` | Generated by the bundle installer. Authenticates the app to the fixed-action host updater over its local Unix socket. |
| `DATA_DIR` | Persistent OAuth state, the forum's atmo.pub signing key, members' notification state, the invite links of a gated forum (`invites.json`), and everything under `extensions/` (see [Extensions](#extensions) below). Losing it disconnects every account, makes the forum a new sender so members approve it again, voids every unredeemed invite, and drops every extension install along with its private data. |
| `HAPPYVIEW_SESSION_SECRET` | Copy of Happyview's session secret for private boards. Must be at least 32 bytes; in production the app refuses to start with a weak one, and treats a weak `ATMOBB_COOKIE_SECRET` the same way. |
| `HAPPYVIEW_CLIENT_KEY` | Optional app identity for Happyview rate limiting. |
| `ATMOBB_AVATAR_BUILDER_URL` | Optional. Links an external avatar builder from profile settings. |

Rotating the Happyview session secret requires changing both environment files and restarting Happyview and atmobb. Rotating the Postgres password requires changing the database role and its environment together; editing only the env file locks Happyview out.

### Extensions

`DATA_DIR/extensions/` holds every install: `registry.json` (which extensions are installed, at which release), `claims.json` (which repository owns which record collection), `timers.json` (pending timer callbacks), `bindings.json` (a cache of which extension is bound to which thread, rebuilt from the forum repo at boot), `.lock` (the single-process lock below), `.staging/` (releases an admin fetched but hasn't confirmed yet, swept after an hour), and one directory per install holding a subdirectory per release it has run (for rollback) plus its private `kv.json`.

Only one running process may hold `DATA_DIR/extensions/.lock` at a time. During a rolling deploy, where an old and a new container briefly share the same `DATA_DIR`, whichever process doesn't hold the lock serves the forum with every extension disabled rather than double-firing timers or racing the lock's holder over installs. A holder that stops renewing its heartbeat (it crashed) is treated as gone after a minute, and the next process to start takes the lock over.

An install's `kv.json` is plain JSON, not encrypted: whoever operates this host, same as with the OAuth state next to it, can read whatever an extension stored there. An extension's guest console log isn't on disk at all, it lives in memory for as long as the process runs and is gone on restart, but it's readable from that install's admin page while the process is up, so an extension author shouldn't log anything private either. Treat `extensions/` the way you already treat the rest of `DATA_DIR`.

`./atmobb backup`'s `oauth.tar.gz` already covers this. `extensions/` lives inside the same `DATA_DIR` tree as `oauth/` and `notify/`, so a backup carries every install, claim, timer, binding, and k/v store along with the OAuth state. A source install's manual `oauth.tar.gz` (see [Backups](#backups)) covers it the same way.

`ATMOBB_EXTENSIONS`, `ATMOBB_EXTENSIONS_DEV`, `ATMOBB_EXTENSION_DIRECTORY`, and `ATMOBB_EXTENSION_DIRECTORY_DID` are operator decisions:

| variable | purpose |
|---|---|
| `ATMOBB_EXTENSIONS` | Set to `off` to disable every extension forum-wide; anything else, or unset, leaves them on. |
| `ATMOBB_EXTENSIONS_DEV` | `1` allows installing from a local `file://` project, for an author testing against this forum. Leave it unset in production. |
| `ATMOBB_EXTENSION_DIRECTORY` | `1` makes this forum the atmobb.app extension directory: it gets the endorsement admin page, and its login requests the scope to publish endorsements. Set it on exactly one forum. |
| `ATMOBB_EXTENSION_DIRECTORY_DID` | The directory forum's DID. Every install, including the directory's own, reads this to look up whether a repository is endorsed; unset, nothing ever shows as endorsed. |

The rest tune the sandbox's resource and rate limits, each with a code default that's usually fine to leave alone. [Extensions](extensions.md#capabilities-and-their-limits) explains what each one governs; only the name and default are repeated here.

| variable | default |
|---|---|
| `ATMOBB_EXTENSIONS_CALL_TIMEOUT_MS` | `5000` |
| `ATMOBB_EXTENSIONS_MEMORY_PAGES` | `1024` (64 KiB pages, so 64 MiB) |
| `ATMOBB_EXTENSIONS_CALL_HOST_CALLS` | `100` |
| `ATMOBB_EXTENSIONS_CALL_ARG_BYTES` | `262144` (256 KB) |
| `ATMOBB_EXTENSIONS_CALL_RETURN_BYTES` | `1048576` (1 MB) |
| `ATMOBB_EXTENSIONS_HOST_IO_MS` | `3000`, always capped at 80% of the call timeout |
| `ATMOBB_EXTENSIONS_RECORD_WRITES_PER_HOUR` | `100` |
| `ATMOBB_EXTENSIONS_NOTIFY_PER_RECIPIENT_PER_DAY` | `5` |
| `ATMOBB_EXTENSIONS_NOTIFY_PER_INSTALL_PER_DAY` | `100` |
| `ATMOBB_EXTENSIONS_ACTIONS_PER_VIEWER_PER_MINUTE` | `30` |
| `ATMOBB_EXTENSIONS_ACTIONS_PER_INSTALL_PER_MINUTE` | `300` |
| `ATMOBB_EXTENSIONS_ANONYMOUS_ACTIONS_PER_INSTALL_PER_MINUTE` | `60` |
| `ATMOBB_EXTENSIONS_TIMER_MIN_DELAY_MS` | `60000` |
| `ATMOBB_EXTENSIONS_TIMER_CAP` | `200` |
| `ATMOBB_KV_MAX_KEYS` | `500` |
| `ATMOBB_KV_MAX_KEY_LENGTH` | `200` |
| `ATMOBB_KV_MAX_VALUE_BYTES` | `65536` (64 KB) |
| `ATMOBB_KV_MAX_STORE_BYTES` | `262144` (256 KB) |
| `ATMOBB_KV_MAX_WRITES_PER_MINUTE` | `60` |

### Common failures

| symptom | check |
|---|---|
| `docker compose up` stops with "Happyview version mismatch" | The running Happyview isn't the one this atmobb release expects. Run `./atmobb upgrade-happyview`, or restore the bundle's `compose.yml` if you edited a tag. |
| Bundle app container exits with `EACCES` on `/data` | `ATMOBB_DATA_DIR` must be owned by uid 10001: `sudo chown -R 10001:10001 /var/lib/atmobb/oauth`. |
| Installer says Node is not executable by `atmobb` | Install Node system-wide rather than under a home-directory version manager. |
| Caddy cannot obtain certificates | Confirm both DNS records reach this host and ports 80/443 are open. |
| Login or form POST fails | `ORIGIN` and `ATMOBB_APP_URL` must equal the public HTTPS forum URL, without a trailing slash. |
| OAuth metadata uses the wrong host | Check `/etc/atmobb/app.env`, restart atmobb, then fetch `/oauth-client-metadata.json` again. |
| App shows “appview down” | Check Caddy, run `curl http://127.0.0.1:3000` on the host, and inspect Happyview logs. |
| Forum edits fail after restart | Confirm `/var/lib/atmobb/oauth` exists and is writable by `atmobb`, then reconnect at `/admin/connect`. |
| Private board operations return 401/403 | Confirm spaces are enabled and both services use exactly the same session secret. |
| Counts are missing | Run the backfill in step 3 and let it finish. |
| Backfill reports `too many clients` | Keep the checked-in Postgres `max_connections=200`; external Postgres needs equivalent capacity. |
