# Local development

This runs a synthetic forum against local Happyview and Postgres containers. Login and member writes still go out to the real atproto network, which matters more than you'd think. More on that below.

## Prerequisites

- [Bun](https://bun.sh) 1.4+
- Node.js 22.19+
- Docker Engine or Desktop with the `docker compose` v2 plugin
- `git`, `curl` 7.76+, `jq`, and `openssl`
- Internet access for image pulls, lexicon resolution, Jetstream, and OAuth
- An atproto account, ideally a test one

Check the versions that are easy to get wrong first:

```sh
node --version
bun --version
docker --version
docker compose version
curl --version | head -n 1
jq --version
```

The Happyview image supports `linux/amd64` and `linux/arm64`.

## 1. Install dependencies

From the repository root:

```sh
bun install --frozen-lockfile
```

Plain `bun install` is only for when you're actually updating dependencies and `bun.lock`.

## 2. Start Postgres and Happyview

```sh
docker compose up -d
docker compose ps
```

Compose uses the Happyview release pinned in `docker-compose.yml`. Happyview listens on `127.0.0.1:3000`, Postgres on `127.0.0.1:5433`, both with development-only credentials. The bootstrap script waits up to 60 seconds for first-run migrations, so give it a minute.

## 3. Resolve your admin DID

Resolve the DID of whatever account you plan to log in with:

```sh
export ADMIN_HANDLE=alice.bsky.social
export ADMIN_DID="$(curl --fail --silent --show-error --get \
  --data-urlencode "handle=$ADMIN_HANDLE" \
  https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle | jq -er .did)"
printf '%s\n' "$ADMIN_DID"
```

The result has to start with `did:`. If you already know your DID, just `export ADMIN_DID=did:plc:...` and skip the lookup.

## 4. Bootstrap an admin API key

Create Happyview's super-user and drop its operator key in `.env`:

```sh
ADMIN_DID="$ADMIN_DID" sh appview/bootstrap-admin.sh > .env
chmod 600 .env
```

Only the key hash goes into Postgres. Rerunning the script rotates the key. If `.env` already has other values in it, run the script without the redirect and replace `HAPPYVIEW_API_KEY` by hand.

This key is for configuring Happyview. The web app never touches it.

## 5. Configure the appview

```sh
sh appview/setup.sh
```

The script creates derived tables, registers public record lexicons, and uploads the query lexicons and Lua scripts. Rerun it whenever you change something under `appview/` or `lexicons/`.

> [!IMPORTANT]
> The script exits on a failed admin request. Don't move on unless the last line is `== done`. A half-configured appview fails three steps later, somewhere that looks unrelated.

## 6. Seed the synthetic forum

The synthetic forum DID doesn't exist on the network, so the seed writes its forum data straight into Postgres:

```sh
RESET=1 ADMIN_DID="$ADMIN_DID" bun appview/seed-dev.ts
```

`ADMIN_DID` gets an admin grant for `/admin`. Defaults are `BOARDS=8`, `THREADS=400`, `REPLIES=4000`, and `AUTHORS=60`. Keep `RESET=1` unless you specifically want a second batch, because leaving it off gives you duplicate boards and posts with fresh rkeys.

> [!WARNING]
> `RESET=1` deletes synthetic records and clears derived statistics. Only ever point it at the disposable development index. Aimed anywhere else, it does exactly what it says it does.

## 7. Verify the appview

Before you start SvelteKit, make sure Happyview is actually returning the seeded forum:

```sh
curl --fail --silent --show-error \
  'http://127.0.0.1:3000/xrpc/app.atmobb.forum.getBoardIndex?forum=did:plc:atmobbdevforum' \
  | jq '{forum: .forum.name, boards: (.boards | length)}'
```

You want the forum name `atmobb dev forum` and a board count above zero. Then run the project checks:

```sh
bun run check
```

## 8. Run the app

Core, without optional plugins:

```sh
bun run dev
```

To work against a trusted external plugin, point Vite at a deployment configuration. The plugin source can live anywhere, including outside this checkout:

```sh
ATMOBB_CONFIG=/absolute/path/to/atmobb.config.mjs bun run dev
```

[Plugins](plugins.md) covers configuration and the capability contracts. Generated public files land in the gitignored `static/plugins/` directory.

Open **http://127.0.0.1:5173** and log in. Atproto's loopback OAuth exception means you don't have to register a client first.

> [!TIP]
> Use `127.0.0.1`, not `localhost`. The OAuth redirect URI is IPv4 loopback, and `localhost` can resolve to `::1`. When that happens the callback breaks, and the error message will not help you figure out why.

### Real-account warning

> [!CAUTION]
> **Everything you do while logged in is a real, public, permanent record.**
>
> The forum index is local. Your identity is not. Public threads, replies, profile changes, memberships, poll votes, and private-board access requests all get written to the logged-in account's atproto repo, announced on the firehose, and indexed by anyone who is listening.
>
> Deleting a record afterward takes it out of your repo. It does not reach into every appview that already saw it. Use a throwaway account.

## Forum writes in development

The synthetic forum has no PDS, so `/admin` writes go directly into local Happyview tables in `index` mode. Production uses `pds` mode. Leave `ATMOBB_FORUM_WRITE_MODE=pds|index` alone unless you're debugging write routing.

## Stop, resume, or reset

```sh
docker compose stop       # stop containers; keep all data
docker compose start      # resume them
docker compose down       # remove containers/network; keep the named volume
```

To wipe it and start clean, run `docker compose down --volumes`. Then repeat steps 2 through 7.

> [!WARNING]
> `--volumes` permanently deletes the local index, the API key, any spaces, and all seeded content. There is no prompt and no undo. On a development machine that's the point; make sure you're pointed at a development machine.

## Troubleshooting

| symptom | check |
|---|---|
| `styleText` export error, an OAuth engine error, or a Vite engine warning | Node is too old; install 22.19 or newer. |
| Happyview image pull fails | Confirm Docker can reach `ghcr.io`, then rerun `docker compose pull happyview`. |
| Bootstrap times out waiting for migrations | Run `docker compose ps` and `docker compose logs happyview postgres`. The first database error is usually the one that matters. |
| `setup.sh` returns 401 | `.env` has a stale key. Rerun step 4, which rotates and replaces it, then rerun setup. |
| Setup cannot resolve a lexicon | Check internet and DNS, then rerun. Record schemas resolve from the live atproto network. |
| OAuth returns to a dead page | Open the app at `http://127.0.0.1:5173`, close any stale login tabs, and retry. |
| Port 3000, 5173, or 5433 is already in use | Stop whatever else is on it. The checked-in dev defaults assume all three are free. |
| The forum page is empty | Run the step 7 verification request. If it fails, read `docker compose logs happyview`. If it returns zero boards, reseed with `RESET=1`. |

## Lexicon code generation

Typed clients get generated into `src/lexicon/`:

```sh
bun run lex
bun run check
```

Run both after you edit anything in `lexicons/`. The publish-only permission sets (`authForum` and `authSysop`) are excluded, because lex-cli can't generate them. Read [Lexicons](lexicons.md) before you change a published schema.

## Package scripts

| script | purpose |
|---|---|
| `bun run dev` | Vite development server on `127.0.0.1:5173`, with optional `ATMOBB_CONFIG` plugins |
| `bun run build` | production adapter-node build, with optional `ATMOBB_CONFIG` plugins |
| `bun run start` | run the built server with Node |
| `bun run preview` | preview a production build |
| `bun run check` | SvelteKit sync and TypeScript check, including generated code |
| `bun run test` | unit tests for pure TypeScript (path helpers, rich text serializers) with Vitest |
| `bun run lex` | regenerate `src/lexicon/` from `lexicons/` |
