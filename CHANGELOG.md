# Changelog

Versions follow [Semantic Versioning](https://semver.org) with the operator's
workload in mind; [Releasing](docs/releasing.md) spells out what each level
means. Every entry names the Happyview release it was tested against.

## Unreleased

- Built-in color themes: Classic, Sky, Bubblegum, Midnight (dark), and Forest, chosen from Admin → Appearance → Theme with a live preview. The choice is stored as an optional `theme` on `app.atmobb.forum.profile`; custom CSS still loads afterwards and overrides it. Publish the updated profile schema before deploying.
- Generated forum, thread, and member Open Graph images now inherit the forum's built-in theme and supported `:root` design-token overrides from Custom CSS. Admin → Appearance → Branding previews the generated result while retaining the finished-PNG override.
- Admin → Appearance is split into Theme, Homepage, Branding (favicon and social preview), and Custom CSS (stylesheet and fonts) sub-tabs.
- The "powered by atmobb" footer badge can be turned off from Admin → Appearance → Branding, stored as an optional `hideCredit` boolean on `app.atmobb.forum.profile`. The home page drops its "Forum identity" card and the "Host your own forum" pitch; the footer badge is the remaining link to the project.
- Homepage settings on Admin → Appearance: a Boards, Latest, or Categories + Latest layout; a classic, compact, or hidden welcome panel for signed-out visitors; up to three featured topics; and a Categories / Latest / Hot switcher on the home page. Stored as an optional `homepage` object on `app.atmobb.forum.profile`; absent values keep the classic board index.
- An optional forum sidebar with board navigation, grouped by category, that collapses into a drawer on small screens. Turned on from the same Homepage settings.
- Boards get an optional `color` (`#RRGGBB`) on `app.atmobb.forum.board`, edited on Admin → Boards and shown as a marker on the home board index.
- Topic tags: up to eight normalized lowercase `tags` on `app.atmobb.discussion.thread`, entered from the composer. Board and latest listings filter by `tag`, search titles with `q`, and the latest query also accepts `board` and `uri`; both queries return each topic's recent participants. Rerun `appview/setup.sh` for the updated Lua scripts and query lexicons.
- Unread and read-position markers on topic lists, tracked per account and forum in the browser's local storage so nothing about reading habits leaves the device.
- Rich text posts support headings and bulleted and numbered lists, in both the editor and BBCode.
- Notifications through atmo.pub: replies, quotes, mentions, and new threads in boards you watch. Members opt in once from settings or the prompt after their first post; each forum is its own atmo.pub sender with a key generated on first boot. A bell in the masthead and a notifications page read the forum's own send log. Members-only boards send bare alerts and only to current members.
- Board watching, as `app.atmobb.forum.watch` records in the member's repo, with a watchers query on the appview.
- `app.atmobb.authForum` gains the watch collection, and the login scope asks for atmo.pub's permission request as a granular `rpc` scope, so members re-consent at their next login. Publish the watch schema and the updated set before deploying; `setup.sh` needs the record schema on the network.
- The data directory now holds `notify/`, with the sender key and notification state. Back it up with everything else and restore it together.
- Forum membership: a forum can be open (the default, unchanged), apply, or invite, set on the new Admin → Members page with an application prompt, an invite cap (default 3), and an invite lifetime (default 14 days). On a gated forum only accepted members who have declared membership can post, vote, or request a members-only board; reading stays public. Gating writes founding `acceptMember` actions for everyone already posting, declared, or on staff (never anyone under a forum-wide ban) and a `gateForum` action, after a confirmation that shows the count; posts written while the forum was open are always served. Applications are `app.atmobb.forum.accessRequest` records with a `forum` field, made at `/apply`; staff approve, deny, or hold them from Admin → Members, and the approver is recorded as sponsor. Members mint invite links at `/settings/invites` and staff from Admin → Members; `/join/<token>` confirms with a POST, and a refused join never spends the invite. The roster lists members with sponsors and lets staff remove one. A forum-wide ban also revokes membership; unban does not restore it. The members-only board request queue moved from Admin → Boards to Admin → Members.
- Schemas, all additive: `app.atmobb.moderation.action` gains the `acceptMember`, `revokeMember`, `holdApplication`, `gateForum`, and `openForum` kinds and the `sponsor`, `via`, `ref`, and `mode` fields; `app.atmobb.forum.profile` gains an optional `membership` object; `app.atmobb.forum.accessRequest` makes `board` optional and adds `forum`. `app.atmobb.forum.getMembership` is a new query, and `getAccessRequests` and `moderation.getLog` take new parameters. The member permission set is unchanged, so nobody re-consents.
- Operators: publish the three record schemas with `goat lex publish --update` (maintainers of the namespace only), rerun `appview/setup.sh` for the `atmobb_member_windows` and `atmobb_forum_gating` tables and the new Lua, then run `appview/backfill.sh` so the rebuild fills both tables. [Happyview](docs/happyview.md#taking-membership-to-production) has the order. The data directory gains `invites.json`; back it up with the rest.
- Known limits: the founding set is computed from the declared roster plus thread authors, last repliers, and up to five participants per thread in the latest feed, so a quiet replier on a long thread who never declared membership can be missed and has to be invited again. Post counts and ranks count every indexed post, including hidden non-member posts, as they already do for bans.
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
