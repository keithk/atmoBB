# How atmobb uses Happyview

[Happyview](https://github.com/gamesgamesgamesgamesgames/happyview) is a Rust and Postgres atproto appview engine. It eats Jetstream, indexes whatever record collections you register with it, and serves XRPC endpoints you write in Lua. Everything forum-specific about atmobb lives in its lexicons, `appview/lua/`, and a few derived tables. I don't patch the engine.

## The pinned upstream image

The Compose files pin `ghcr.io/gamesgamesgamesgamesgames/happyview:2.14.0`, the upstream release I've actually tested against. The image supports amd64 and arm64.

atmobb ignores Happyview's OAuth client and its PDS-proxy write paths. It handles login itself and writes public records straight to users' PDSes. `HAPPYVIEW_CLIENT_KEY`, if you set it, just identifies read requests for rate limiting.

> [!WARNING]
> Startup can run forward-only migrations, so back up Postgres before moving Happyview. Once those have run, you cannot go back down a version.

A Happyview bump is always its own atmobb release ([Releasing](releasing.md)). The release image bakes the version it was tested against as `HAPPYVIEW_EXPECTED_VERSION`, and `appview/container-setup.sh` compares it with the running instance's `GET /config` before the app starts. Operators on the release bundle move both together with `./atmobb upgrade-happyview`, which backs up first. Maintainers change `ARG HAPPYVIEW_VERSION` in the `Dockerfile` and the tag in every Compose file; `infra/release/check-pins.sh` fails if any disagree.

## What setup.sh installs

`appview/setup.sh` configures a running instance through the admin API. Rerunning it is safe, and it works against remote instances through the `HV` and `PG_EXEC` variables. `appview/bootstrap-admin.sh` creates the operator key it needs.

- **Derived tables:** `atmobb_thread_stats` holds each thread's board, title, reply count, and last activity. `atmobb_post_counts` holds post totals by forum and DID; the appview still maintains it, but the app no longer reads it. `atmobb_firsts` holds each member's first served post per forum and board, plus one forum-level row, written when the post arrives and never removed by a trigger. `atmobb_stamp_awards` holds by-hand stamp awards from `awardStamp` actions, with the staffer who gave one and the time a `revokeStamp` closed it.
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

## Membership windows and gating periods

Two more derived tables carry forum membership, both maintained by the `record.create` script on `app.atmobb.moderation.action` and mirrored by the development forum's index writes. Happyview runs a create script before it indexes the record, and the script sees only that record (`record`, `uri`, `did`), so a script that needs the neighbours of its record reads them from `happyview_records` itself.

- **`atmobb_member_windows`** holds one row per acceptance: forum DID, member DID, `since`, `until`, `sponsor`, `via`, and the `acceptMember` action's URI as the key. `revokeMember`, or a forum-wide `ban`, closes the open window by setting `until`; `unban` leaves it closed. History is kept, so a re-acceptance opens a new row rather than reviving the old one. A partial unique index allows at most one open window (`until IS NULL`) per forum and member: an accept that finds an open window is a no-op, and so is a close that finds none.
- **`atmobb_forum_gating`** holds one row per stretch during which a forum enforced membership: forum DID, `gated_since`, `opened_at` (null while gated), and the join `mode`. `gateForum` opens a period and `openForum` closes it; both are signed by the forum with its own account as subject. A post written at a time no period covers was written while the forum was open and is served regardless of membership.

Both tables apply actions in the order of their `createdAt`, then URI, whatever order the records reach the index in. An accept whose later revocation or forum-wide ban is already indexed inserts its window closed at that action's time, and a close never touches a window opened after it. `infra/rebuild-stats.sql` reconstructs both tables from the indexed actions by walking each forum's (and each member's) open and close actions in that order, so a member with two accept-revoke cycles comes back with two closed rows.

### Taking membership to production

Moving an instance that predates membership takes three steps, in this order:

1. **Publish the changed record schemas** from the authority account. Three of them changed, all additively: `goat lex publish --update lexicons/app/atmobb/moderation/action.json lexicons/app/atmobb/forum/profile.json lexicons/app/atmobb/forum/accessRequest.json`. Self-hosters skip this; the schemas are already on the network. [Lexicons](lexicons.md) has the details.
2. **Rerun `appview/setup.sh`.** It creates the two tables, re-resolves the record schemas, uploads the `getMembership` query and the updated `getAccessRequests` and `getLog` schemas, and installs the Lua that maintains the tables from here on.
3. **Backfill and rebuild.** The trigger only sees actions that arrive after it's installed. With both tables empty the index knows no gating period and no acceptance, so it enforces nothing and every post is served, whatever the forum's profile says. Run `appview/backfill.sh` (see [Backfill](#backfill)); it ends by running `infra/rebuild-stats.sql`, which fills both tables from every indexed action. On an instance where no forum has gated yet the rebuild finds nothing to insert, but it's cheap, so run it anyway.

Until step 2 runs, the app has no membership query to ask, and the gated modes stay hidden on Admin → Members. That's deliberate: a forum can't gate itself on an index that wouldn't enforce it.

## Stamps

Stamps are resolved when a page is read. `getStamps`, `getMembers`, `getMembership`, and `getThreadPage` match the forum's `app.atmobb.forum.stamp` records against `atmobb_firsts`, `atmobb_member_windows`, profile dates, and `atmobb_stamp_awards`, so a stamp authored after the fact goes to everyone who already qualifies. The same SQL is copied into each of those scripts, because Lua scripts can't share code; the integration test checks the copies still match.

`atmobb_firsts` is written by the thread and reply create triggers, and only for a served post: a board that exists and has no space, on a forum that isn't delisted, inside the author's membership window if the forum is gated. The trigger can't know whether a post will later be hidden, and nothing removes a row, so deleting or hiding the post keeps the stamp. `infra/rebuild-stats.sql` starts from the records instead, so a rebuild drops firsts whose posts have been deleted or hidden since; that is the one place a stamp gets taken back.

The "early days" cutoff and the "first light" test live in the Lua, so each appview issues its own network set to every forum it serves.

### Taking stamps to production

Same shape as membership, in this order:

1. **Publish the schemas** from the authority account: `goat lex publish` for `lexicons/app/atmobb/forum/stamp.json` and `lexicons/app/atmobb/forum/getStamps.json`, and `goat lex publish --update` for `membership.json`, `profile.json`, and `moderation/action.json`. Self-hosters skip this.
2. **Rerun `appview/setup.sh`.** It creates `atmobb_firsts` and `atmobb_stamp_awards`, registers the stamp collection, uploads the `getStamps` query and the updated `getMembers`, `getMembership`, `getThreadPage`, and `getLog` schemas, and installs the Lua.
3. **Backfill and rebuild.** The triggers only see posts and actions that arrive after they're installed, and both tables start empty, so nobody holds a first-post or by-hand stamp until `appview/backfill.sh` runs and `infra/rebuild-stats.sql` fills them from history.

## Delisting a forum

A shared appview sometimes needs to drop a forum from the directory, the webring, topic federation, and the cross-forum listings on member profiles, without touching its records:

```sh
docker compose exec -T postgres psql -U happyview -d happyview \
  -c "INSERT INTO atmobb_delisted_forums (did, reason) VALUES ('did:plc:...', 'spam')"
```

Delete the row to relist. Nothing leaves the index, and the delisted forum's own app keeps working. Stopping that app is a separate decision.

## What atmobb doesn't use

I don't use Happyview's OAuth write delegation or its web dashboard. Writes go through atmobb's own OAuth client, and I configure the instance through the admin API.
