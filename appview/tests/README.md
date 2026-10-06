# Opt-in HappyView space contract smoke

```sh
python3 appview/tests/spaces-smoke.py --run
```

This is **not** part of vitest. It needs Python 3 and a working Docker daemon.
It pulls Postgres 17, HappyView 2.16.0, and a Node 22 HTTP-sidecar image before
creating a uniquely named internal Docker network. It never reads `.env`, uses
an existing database, mounts project files, or contacts real atproto identities.
The admin, creator, and member DIDs are synthetic `.invalid` identities.

Only HappyView requests a loopback-published port; Postgres has none. On Docker
versions that suppress published ports on internal networks, a test-owned Node
sidecar performs HTTP requests via `docker exec`. It stays on the same isolated
network. This is a transport fallback, not a fake engine or database.

Secrets are generated per invocation, supplied through process environment or
stdin, and never written to project files. Container logging is disabled.
`GET /admin/settings` output is allowlisted because the server also returns its
generated private attestation key from that endpoint. Docker administrators can
inspect container environment while a run is alive; do not use this test for
real credentials. `finally` removes only resources bearing this run's owner
label, including on ordinary failures, Ctrl-C, or SIGTERM. SIGKILL/daemon failure
cannot guarantee cleanup; the JSON output identifies test-owned resource names.

## What it proves

- HappyView boots against fresh Postgres and applies its SQL migrations.
- Admin settings enable spaces and the PDS migration flag; the dedicated proxy
  API round-trips. **This does not test SDK or PDS repository migration.**
- A synthetic `did_web` service identity makes HappyView the URI authority while
  the signed-cookie creator remains the owner.
- The cookie wire format matches `src/lib/server/happyview-session.ts`.
  This script does not execute that TypeScript module or test OAuth.
- Deterministic, forum-scoped board keys; separate member-list policies;
  creator ownership and cursor pagination; member read/write flags; actual
  member-authored create/get/list records; `includeValues`; writer-set repos;
  disallowed collections; missing-record errors; denied/removed members.
- Local record lexicons upload without backfill or network lexicon discovery.
  This asserts collection policy, not record-schema validation.

Every HTTP observation records its status, response shape, and disposable
fixture response. Image digests and cleanup results appear in the same JSON-lines
output. Unexpected HTTP failures stop the run; access-denial discrepancies are
collected so removal checks still run, then cause exit status 1.

## HappyView 2.16.0 contracts and failures

Source: `gamesgamesgamesgamesgames/happyview@cb3cd86`.
HappyView image digest:
`sha256:ebc1e39fdf845a52d5c2017809bb447b450b2b4dde32c89d3a970a697dad1ce9`.

- `getRecord` for a missing record returns HTTP 404 with
  `{"error":"Record not found"}`, not a `NotFound`/`RecordNotFound` code.
  Wrappers must not treat unrelated 404 responses as absent records.
- A member with `read=false` is denied by `getRecord`, but
  `listRecords(includeValues=true)` returns both their own record values
  and another author's values when that author's `repo` is requested.
  `listRepos` returns the writer set. This happens with **both**
  `write=true` and `write=false`. The smoke intentionally fails all six denial
  assertions rather than blessing this behavior: **exit 1 is the expected red
  security gate on this image**, not a Docker setup failure. Removing the member
  produces HTTP 403 on all three endpoints. Application-side guards do not
  protect requests made directly to these engine endpoints.
- `putMember` returns HTTP 201 with `member.access.{read,write}`, whereas
  `listMembers` returns `members[].{did,read,write}` directly.
- `simplespace.getSpace` nests policies inside `config`, and also includes a
  snake-case `space` object. `com.atproto.space.getSpace` is not its route.
- Without an explicit `repo`, cookie-authenticated `listRecords` lists only the
  caller's own records; omit `includeValues` and no `value` fields are returned.

These observations concern the engine API, not an executed wrapper integration.
Re-run after changing the pinned engine before adjusting expectations.
