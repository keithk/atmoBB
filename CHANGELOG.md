# Changelog

Versions follow [Semantic Versioning](https://semver.org) with the operator's
workload in mind; [Releasing](docs/releasing.md) spells out what each level
means. Every entry names the Happyview release it was tested against.

## Unreleased

- Notifications through atmo.pub: replies, quotes, mentions, and new threads in boards you watch. Members opt in once from settings or the prompt after their first post; each forum is its own atmo.pub sender with a key generated on first boot. A bell in the masthead and a notifications page read the forum's own send log. Members-only boards send bare alerts and only to current members.
- Board watching, as `app.atmobb.forum.watch` records in the member's repo, with a watchers query on the appview.
- `app.atmobb.authForum` gains the watch collection, and the login scope asks for atmo.pub's permission request as a granular `rpc` scope, so members re-consent at their next login. Publish the watch schema and the updated set before deploying; `setup.sh` needs the record schema on the network.
- The data directory now holds `notify/`, with the sender key and notification state. Back it up with everything else and restore it together.
- Tested against Happyview 2.14.0.

## 0.1.0

First versioned release. Happyview 2.14.0.

- Container image at `ghcr.io/keithk/atmobb` for amd64 and arm64, built and
  published by GitHub Actions on every `vX.Y.Z` tag.
- Compose bundle (`atmobb-X.Y.Z.tar.gz`) with Postgres, Happyview, a setup job,
  the web app, an optional Caddy overlay, and an `./atmobb` operator script
  covering install, upgrade, Happyview upgrades with backup, backfill, and
  backup.
- The setup job refuses to start the app when the running Happyview is not the
  release this build was tested against.
- `GET /api/version` reports the running atmobb version and its expected
  Happyview version.
- The presence high-water mark now lives in `DATA_DIR` instead of a
  working-directory-relative `data/`.
- `appview/*.sh` accept `PG_EXEC=""` to run `psql` directly against libpq
  environment variables.
