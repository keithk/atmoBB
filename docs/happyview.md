# How atmobb uses Happyview

[Happyview](https://github.com/gamesgamesgamesgamesgames/happyview) is a Rust and Postgres atproto appview engine. It eats Jetstream, indexes whatever record collections you register with it, and serves XRPC endpoints you write in Lua. Everything forum-specific about atmobb lives in its lexicons, `appview/lua/`, and two derived tables. I don't patch the engine.

## The pinned upstream image

The Compose files pin `ghcr.io/gamesgamesgamesgamesgames/happyview:2.14.0`, the upstream release I've actually tested against. The image supports amd64 and arm64.

atmobb ignores Happyview's OAuth client and its PDS-proxy write paths. It handles login itself and writes public records straight to users' PDSes. `HAPPYVIEW_CLIENT_KEY`, if you set it, just identifies read requests for rate limiting.

> [!WARNING]
> To upgrade Happyview, change its tag in every Compose file and recreate the container. Startup can run forward-only migrations, so back up Postgres first. Once those have run, you cannot go back down a version.

## What setup.sh installs

`appview/setup.sh` configures a running instance through the admin API. Rerunning it is safe, and it works against remote instances through the `HV` and `PG_EXEC` variables. `appview/bootstrap-admin.sh` creates the operator key it needs.

- **Derived tables:** `atmobb_thread_stats` holds each thread's board, title, reply count, and last activity. `atmobb_post_counts` holds post totals by forum and DID.
- **Record lexicons:** setup registers each record collection through `POST /admin/network-lexicons`. Happyview then resolves the published schema and starts indexing that collection off Jetstream. [Lexicons](lexicons.md) covers the resolution chain.
- **Query and procedure lexicons:** setup uploads the instance's XRPC schemas directly from `lexicons/`, including the read API and the `createThread` and `createReply` procedures. atmobb never calls those procedures itself, since its writes go through its own OAuth client.
- **Lua scripts:** every query has a Lua implementation. Record triggers keep thread and post statistics current as threads and replies are created, edited, and deleted, and apply moderation actions as they arrive.

## Data paths

**Writes:** the app writes records directly to the author's PDS with its own OAuth client. The PDS announces the commit on the firehose, Jetstream delivers it to Happyview, and Happyview indexes it and updates stats. Usually a few seconds end to end.

**Reads:** the app sends XRPC queries to `HAPPYVIEW_URL`, where Lua scripts query Postgres. Reads can be anonymous. `HAPPYVIEW_CLIENT_KEY` identifies the app for rate limiting if you want that.

Members-only board content uses Happyview permissioned spaces instead of public repos and the index. See [Members-only boards](private-boards.md).

The synthetic development forum has no PDS either, so its forum-side writes go straight into Happyview's tables. See [Forum writes in development](development.md#forum-writes-in-development).

## Backfill

Jetstream only hands you live events. To index records created before startup, or during an outage, run:

```sh
HV=http://127.0.0.1:3000 \
  PG_EXEC="docker compose exec -T postgres" sh appview/backfill.sh
```

> [!WARNING]
> Run this on the appview host, over loopback. Production proxies must never expose `/admin` to the internet. The [self-hosting guide](self-hosting.md#https-and-network-exposure) blocks it at the proxy for exactly this reason.

The script reads `HAPPYVIEW_API_KEY` from the environment or `.env`, starts an asynchronous job covering every registered collection, and polls it to completion.

The annoying part is that Happyview runs `record.create` scripts during backfill too, which will happily double-count your derived stats. So `backfill.sh` rebuilds the derived tables from indexed records after each job finishes. Run it as many times as you like and the counts and moderation state come out the same.

## Delisting a forum

A shared appview sometimes needs to drop a forum from the directory, the webring, topic federation, and the cross-forum listings on member profiles, without touching its records:

```sh
docker compose exec -T postgres psql -U happyview -d happyview \
  -c "INSERT INTO atmobb_delisted_forums (did, reason) VALUES ('did:plc:...', 'spam')"
```

Delete the row to relist. Nothing leaves the index, and the delisted forum's own app keeps working. Stopping that app is a separate decision.

## What atmobb doesn't use

I don't use Happyview's OAuth write delegation or its web dashboard. Writes go through atmobb's own OAuth client, and I configure the instance through the admin API.
