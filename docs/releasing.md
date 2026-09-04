# Releasing

A release pins three things together: the built app, the appview configuration it expects (`lexicons/`, `appview/lua/`, the derived-table SQL in `appview/setup.sh`), and the Happyview image it was tested against. A version tag makes that pin explicit so operators can install a known-good set and move between known-good sets.

## What ships

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which:

1. runs `infra/release/check-pins.sh`, `bun run check`, `bun run test`, and `bun run build`;
2. builds the `Dockerfile` for `linux/amd64` and `linux/arm64` and pushes `ghcr.io/keithk/atmobb:X.Y.Z`, `:X.Y`, and `:latest`;
3. assembles `atmobb-X.Y.Z.tar.gz` from `infra/release/` plus the self-hosting guide, and publishes a GitHub Release with the tarball, `SHA256SUMS`, and this version's `CHANGELOG.md` section as notes.

Pushes to `main` build and push `ghcr.io/keithk/atmobb:edge` with no release. Pull requests build the image without pushing.

The image contains the built app under `/app/build`, production `node_modules`, and `appview/`, `lexicons/`, and `infra/rebuild-stats.sql`, so the same image serves the forum and runs the setup, bootstrap, and backfill scripts. It runs as uid 10001 with `DATA_DIR=/data`.

## Version levels

Semver, with meanings tied to what an operator has to do:

| level | contents | operator action |
|---|---|---|
| patch | app-only fixes | `./atmobb upgrade` |
| minor | new features; may add Lua queries, lexicons, or derived-table columns | `./atmobb upgrade`; the setup job applies the rest. Notes say if a backfill is needed. |
| major | Happyview pin bump with migrations, removed or renamed env vars, anything needing manual steps | back up, read the migration section, `./atmobb upgrade-happyview` |

A Happyview bump is always its own release, never folded into unrelated app changes, so the release with the risky step is easy to spot.

Record schemas under `app.atmobb.*` are published network-wide and records already exist in members' repos. Schema changes to record types must stay backward compatible regardless of the atmobb version. Query and procedure lexicons are per instance and can change with any release.

## Cutting a release

1. Update `CHANGELOG.md`: move `Unreleased` into a `## X.Y.Z` section and state the Happyview version on its first line.
2. Set `version` in `package.json` and the two `ghcr.io/keithk/atmobb:` tags in `infra/release/compose.yml` to `X.Y.Z`.
3. For a Happyview bump, also change `ARG HAPPYVIEW_VERSION` in `Dockerfile` and the image tag in `docker-compose.yml`, `infra/appview-compose.yml`, `infra/appview-compose.example.yml`, `infra/release/compose.yml`, `docs/self-hosting.md`, and `docs/happyview.md`.
4. Run `sh infra/release/check-pins.sh`. It fails if any of the above disagree.
5. Commit, tag `vX.Y.Z`, push the commit and the tag.
6. Once the workflow finishes, upgrade atmobb.app first, then hosted tenants.

## How the version gate works

The image bakes `HAPPYVIEW_EXPECTED_VERSION` from the Dockerfile `ARG`. On every `docker compose up`, the `setup` service runs `appview/container-setup.sh`, which reads `GET /config` on Happyview and exits non-zero if `.version` differs. The web app depends on setup completing successfully, so a stack whose Happyview was moved without atmobb, or the reverse, stops with a message pointing at `./atmobb upgrade-happyview` instead of serving pages against a schema it was not tested with.

`./atmobb upgrade` compares the bundle's Happyview pin with the running container's image and refuses to recreate Happyview. `./atmobb upgrade-happyview` takes a backup, recreates only Happyview, waits for it to answer, then runs setup and restarts the app.

`GET /api/version` on a running forum returns `{ "version", "happyview" }` for confirming an upgrade landed.
