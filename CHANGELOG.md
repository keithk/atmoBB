# Changelog

Versions follow [Semantic Versioning](https://semver.org) with the operator's
workload in mind; [Releasing](docs/releasing.md) spells out what each level
means. Every entry names the Happyview release it was tested against.

## Unreleased

- Extensions: any admin can install a sandboxed extension from a git URL, no server access needed. An extension is TypeScript compiled to WebAssembly and run inside atmoBB, one instance per install, with no filesystem or network of its own; it reaches the forum only through the capabilities (`kv`, `records`, `timers`, `notify`) an admin grants it at install. It can show a panel on a thread staff attached it to, or on its own page at `/ext/<repository>`; keep private state; publish records to the forum's own repo, in NSIDs under the extension's own authority; run on a schedule; and send notifications through atmo.pub. Install review shows what it would publish, what it can do and see, and whether the atmobb.app directory has endorsed the repository or reviewed this exact release, a trust signal, not a gate. Updates, rollback, disable, and uninstall all go through the same review, with an `openWork` handler and a force option for an extension with work in progress. The [extension authoring kit](extension-kit/README.md) scaffolds a project, builds it, and runs it against a dev forum before you ever tag a release. See [Extensions](docs/extensions.md) for the full picture.
- Schemas, both new and additive, atmoBB's own: `app.atmobb.extension.binding` (which thread an extension is attached to, written only by the forum account) and `app.atmobb.extension.endorsement` (which repositories and release SHAs the atmobb.app directory forum's staff reviewed, written only by that forum). Neither is indexed by Happyview; both are read straight from the writing forum's own PDS, so publishing them needs no `appview/setup.sh` rerun and no backfill. An extension's own record schemas are a different thing: they ship inside its release, under the author's own NSID authority, never `app.atmobb`, and atmoBB never publishes those.
- Keith owes, before this reaches a real forum:
  - [ ] Publish `app.atmobb.extension.binding` and `app.atmobb.extension.endorsement` from the authority account with `goat lex publish`.
  - [ ] Set `ATMOBB_EXTENSION_DIRECTORY=1` and `ATMOBB_EXTENSION_DIRECTORY_DID` on atmobb.app, and nowhere else.
  - [ ] Set `ADDRESS_HEADER`/`XFF_DEPTH` on every deployment behind Caddy, so signed-out extension actions rate-limit per visitor instead of per proxy.
  - [ ] Redeploy the deploy group (atmobb, internet-club, psingletary, thoriumsim), wait for the PDS's permission-set cache (about 10 minutes), then reconnect the forum account on any site that installs an extension.
  - [ ] Confirm whether a deploy-dashboard redeploy ever runs the old and new containers against the same `DATA_DIR` for longer than the extensions lock's stale timeout assumes.
  - [ ] Create the directory forum on atmobb.app.
  - [ ] Publish extension-kit to npm once outside authors are invited; first fix its relative import into `src/lib/extensions/contract`, which only resolves inside this repository, and the absolute `file:` dependency `new` writes into a scaffolded project.
  - [ ] Run the manual scope check on a real PDS (a `repo:` scope outside `app.atmobb`) and the browser smoke checks for frame isolation.
  - [ ] Pick the game's final name and publish its lexicons. Working name seven-powers, placeholder NSID authority `is.keith.sevenpowers`.

## 0.4.0

Tested against Happyview 2.14.0. No backfill is required.

- Thread links now include readable board and title slugs while retaining the immutable AT Protocol identity used to resolve them. Old links and links with stale slugs redirect to the current canonical URL, so existing bookmarks keep working when a thread title changes.

## 0.3.1

Tested against Happyview 2.14.0. No backfill is required.

- Fixed Admin → Updates failing at the backup step with `sudo: The "no new privileges" flag is set`. The updater and hosting controller run `./atmobb` as root under systemd's `NoNewPrivileges`, and the script now skips `sudo` when it's already root. A 0.3.0 bundle install still runs its old installed updater, so update it once by hand: unpack the new bundle over the install directory, keeping `.env`, and rerun `./atmobb install --yes`.
- Admin → Hosting can now edit the `/host` page's heading and body with the rich text editor, and turn invite codes off so anyone logged in can request a forum for approval. The request form asks, optionally, what the requester is building and for a link. Hosting itself stays optional and off unless `ATMOBB_HOSTING=1` is set.
- Fixed the release installer failing with `invalid user: '10001'` on hosts whose `install` is uutils rather than GNU coreutils (Ubuntu 26.04 ships uutils by default).
- The hosting overlay (`compose.hosting.yml`) now passes `RESEND_API_KEY` to the operator forum, so hosting request emails send on release-bundle installs.

## 0.3.0

Tested against Happyview 2.14.0. No backfill is required.

- Release-bundle installations now have **Admin → Updates**. The installer adds a root-owned, authenticated updater with a narrow Unix-socket API; the web app can request only the latest stable release or, after explicit confirmation, an exact commit from `main`, and never receives Docker or shell access. Updates download and verify the release bundle, prepare images or finish the source build before replacing containers, back up Postgres, OAuth data, secrets, and Compose/Caddy configuration before migration, force-run Happyview setup, verify image pins and service health, and report durable progress, bounded logs, the installed commit, failures, and the backup path. Existing bundle installations can rerun `./atmobb install` with their original options to add the updater without rotating secrets or replacing data.
- The release stack now supports stable per-instance identities, Compose projects, loopback ports, data directories, updater services, and sockets. Managed provisioning and updates share a host-wide lock so expensive operations run one at a time; waiting work remains visible. The release bundle also includes the operator-only hosting overlay.
- Experimental isolated hosting replaces new shared-Happyview tenant provisioning: each approved forum gets its own atmobb app, Happyview, PostgreSQL database and volume, secrets, OAuth data, updater, and Caddy routes. An opt-in, root-owned hosting controller backs **Admin → Hosting**, with durable capacity and port reservations, collision checks, fail-closed state, retryable failed provisions that retain their slot, forum identity checks, blocked public Happyview admin routes, and stable or `main` fleet update controls. Capacity starts at zero. Existing shared installations remain visible as legacy sites and are not migrated automatically. Operators should read [Hosted tenants](docs/hosted-tenants.md) before enabling this experimental service and independently test host capacity, backup restoration, and Happyview migration behavior.
- Members can keep account-wide profile defaults while overriding display name, bio, pronouns, website, title, avatar, and signature for one forum. Avatar upload, Bluesky restoration, and the userpic maker respect the selected scope; an explicitly empty forum value can hide an inherited field.
- Notification preferences can be enabled or disabled account-wide or for one forum. Existing forum overrides are preserved when the account default changes, delivery still requires that forum's atmo.pub authorization, and unreadable preferences fail closed by withholding new alerts.
- Personal color-theme preferences can apply across atmobb or only on one forum. A user can select any built-in theme or preserve a forum's own colors; personal theme tokens load after owner custom CSS while retaining non-color customizations. Settings now use full-width Profile and Styles tabs.
- Boards can have an optional single emoji as well as an identity color. The same emoji, color marker, and board label now appear consistently in the board index, sidebar, topic lists, and topic headers.
- Fixed reply and quote controls in both local and federated topic routes so the editor opens reliably, receives the intended mention or quoted post, and scrolls into view.
- Fixed forum-account stamp creation by adding `app.atmobb.forum.stamp` to the sysop permission set and requesting the write scope explicitly for PDSes with a cached permission set. Reconnect the forum account from **Admin → Connection** if stamp writes were previously denied.
- Schemas, additive: `app.atmobb.actor.profile` gains account notification and theme defaults plus per-forum profile and theme overrides; `app.atmobb.forum.board` gains optional `emoji`; and `app.atmobb.authSysop` gains stamp writes. Namespace maintainers should publish the two updated record schemas with `goat lex publish --update` and publish the updated sysop permission set before deploying. No appview setup or backfill changes are needed for these fields.

## 0.2.1

Tested against Happyview 2.14.0.

- Board and stamp color fields now include native color pickers while retaining editable hex values.
- Homepage topic sections use lighter separators without redundant row dividers.

## 0.2.0

Tested against Happyview 2.14.0.

- Built-in color themes: Classic, Sky, Bubblegum, Midnight (dark), and Forest, chosen from Admin → Appearance → Theme with a live preview. The choice is stored as an optional `theme` on `app.atmobb.forum.profile`; custom CSS still loads afterwards and overrides it. Publish the updated profile schema before deploying.
- Generated forum, thread, and member Open Graph images now inherit the forum's built-in theme and supported `:root` design-token overrides from Custom CSS. Admin → Appearance → Branding previews the generated result while retaining the finished-PNG override.
- Admin → Appearance is split into Theme, Homepage, Branding (favicon and social preview), and Custom CSS (stylesheet and fonts) sub-tabs.
- The forum hero (name and tagline) now shows only on the home page; every other page starts at the navigation. The forum DID is no longer printed in the hero; it stays on Admin → Connect and at `/.well-known/atproto-did`. An optional rich **intro**, edited on Admin → Forum profile with the post editor, renders in the hero under the tagline. Stored as an optional `intro` array of richtext blocks on `app.atmobb.forum.profile`, so publish the updated profile schema before deploying. The description field is labelled Tagline in the admin since it also feeds search and social previews.
- The "powered by atmobb" footer badge can be turned off from Admin → Appearance → Branding, stored as an optional `hideCredit` boolean on `app.atmobb.forum.profile`. The home page drops its "Forum identity" card and the "Host your own forum" pitch; the footer badge is the remaining link to the project.
- Homepage settings on Admin → Appearance: a Boards, Latest, or Categories + Latest layout; a classic, compact, or hidden welcome panel for signed-out visitors; up to three featured topics; and a Categories / Latest / Hot switcher on the home page. Stored as an optional `homepage` object on `app.atmobb.forum.profile`; absent values keep the classic board index.
- Featured topics can now be enabled explicitly and chosen from recent threads or by pasting a public topic URL. The home-page Categories / Latest / Hot switcher is styled as a segmented view control rather than another navigation bar.
- An optional forum sidebar with consistent outline-icon navigation, grouped by category, that collapses into a drawer on small screens. Turned on from the same Homepage settings.
- Boards get an optional `color` (`#RRGGBB`) on `app.atmobb.forum.board`, edited on Admin → Boards and shown as a marker on the home board index.
- Admin → Boards groups boards under their visible categories, nests child boards under their parents, and reorders boards only among peers in the same category or parent.
- Topic tags: up to eight normalized lowercase `tags` on `app.atmobb.discussion.thread`, entered from the composer. Board and latest listings filter by `tag`, search titles with `q`, and the latest query also accepts `board` and `uri`; both queries return each topic's recent participants. Rerun `appview/setup.sh` for the updated Lua scripts and query lexicons.
- Unread and read-position markers on topic lists, tracked per account and forum in the browser's local storage so nothing about reading habits leaves the device.
- Rich text posts support headings and bulleted and numbered lists, in both the editor and BBCode.
- Inline mentions show member avatars in both the rich-text editor and rendered posts.
- The login page and signed-out home welcome use the same framed atmosphere card as the reply gate, with a shared rotating list of compatible AT Protocol apps. The masthead uses the compact icon-only atmobb mark.
- Notifications through atmo.pub: replies, quotes, mentions, and new threads in boards you watch. Members opt in once from settings or the prompt after their first post; each forum is its own atmo.pub sender with a key generated on first boot. A bell in the masthead and a notifications page read the forum's own send log. Members-only boards send bare alerts and only to current members.
- Notification delivery gives cold relay workers longer to answer, logs refused sends, and leaves refused sends eligible for immediate retry instead of starting the cooldown.
- Board watching, as `app.atmobb.forum.watch` records in the member's repo, with a watchers query on the appview.
- `app.atmobb.authForum` gains the watch collection, and the login scope asks for atmo.pub's permission request as a granular `rpc` scope, so members re-consent at their next login. Publish the watch schema and the updated set before deploying; `setup.sh` needs the record schema on the network.
- The data directory now holds `notify/`, with the sender key and notification state. Back it up with everything else and restore it together.
- Forum membership: a forum can be open (the default, unchanged), apply, or invite, set on the new Admin → Members page with an application prompt, an invite cap (default 3), and an invite lifetime (default 14 days). On a gated forum only accepted members who have declared membership can post, vote, or request a members-only board; reading stays public. Gating writes founding `acceptMember` actions for everyone already posting, declared, or on staff (never anyone under a forum-wide ban) and a `gateForum` action, after a confirmation that shows the count; posts written while the forum was open are always served. Applications are `app.atmobb.forum.accessRequest` records with a `forum` field, made at `/apply`; staff approve, deny, or hold them from Admin → Members, and the approver is recorded as sponsor. Members mint invite links at `/settings/invites` and staff from Admin → Members; `/join/<token>` confirms with a POST, and a refused join never spends the invite. The roster lists members with sponsors and lets staff remove one. A forum-wide ban also revokes membership; unban does not restore it. The members-only board request queue moved from Admin → Boards to Admin → Members.
- On gated forums, the member directory, profile headers, and profile hovercards identify who invited or approved a member, or mark them as an original member. Staff and sponsors get the corresponding visibility into whom they sponsored.
- Schemas, all additive: `app.atmobb.moderation.action` gains the `acceptMember`, `revokeMember`, `holdApplication`, `gateForum`, and `openForum` kinds and the `sponsor`, `via`, `ref`, and `mode` fields; `app.atmobb.forum.profile` gains an optional `membership` object; `app.atmobb.forum.accessRequest` makes `board` optional and adds `forum`. `app.atmobb.forum.getMembership` is a new query, and `getAccessRequests` and `moderation.getLog` take new parameters. The member permission set is unchanged, so nobody re-consents.
- Operators: publish the three record schemas with `goat lex publish --update` (maintainers of the namespace only), rerun `appview/setup.sh` for the `atmobb_member_windows` and `atmobb_forum_gating` tables and the new Lua, then run `appview/backfill.sh` so the rebuild fills both tables. [Happyview](docs/happyview.md#taking-membership-to-production) has the order. The data directory gains `invites.json`; back it up with the rest.
- Known limits: the founding set is computed from the declared roster plus thread authors, last repliers, and up to five participants per thread in the latest feed, so a quiet replier on a long thread who never declared membership can be missed and has to be invited again.
- Forum-account OAuth requests now ask explicitly for moderation-record write access, avoiding stale cached permission-set grants; authorization failures direct operators to reconnect the account from Admin → Connection.
- Fixed board and latest queries failing when Happyview returned tags or participant aggregates as `jsonb`, and fixed long text overflowing generated Open Graph cards instead of clamping.
- Stamps replace post counts and rank ladders. Per-member post counts and the rank ladder are gone from the post rail, hovercards, the members list, the admin roster, profile pages, meta descriptions, and Open Graph images; the join date stays as "here since". A stamp is an `app.atmobb.forum.stamp` record in the forum's repo (a name, a two-color look with a shape preset, and one trigger: first post in a board, first post on this forum, profile created before a date, arrived by invite, application, or founding, or given by hand), authored on the new Admin → Stamps page with a light and dark preview, a contrast warning under 3:1, and retire. Triggers are matched at read time, so a new stamp is retroactive. A forum that authors nothing gets an arrival stamp and one first-post stamp per board in the board's color, hideable with `hideDefaultStamps` on the forum profile; every appview issues a network set ("first light", "early days"). Members wear up to three from their tray at `/settings/stamps`, saved as `wearing` on their membership record. Forum-wide staff give and revoke by-hand stamps from the member's profile page as `awardStamp` and `revokeStamp` moderation actions. Members-only boards never fire first-post stamps.
- Schemas, all additive: `app.atmobb.forum.stamp` and `app.atmobb.forum.getStamps` are new; `app.atmobb.forum.membership` gains optional `wearing`; `app.atmobb.moderation.action` gains the `awardStamp` and `revokeStamp` kinds and optional `actor`; `app.atmobb.forum.profile` gains optional `hideDefaultStamps` and deprecates `ranks`, which is no longer read. `getMembers`, `getMembership`, `getThreadPage`, and `moderation.getLog` gain optional output fields, `getLog` gains a `stamps` family, and their post-count fields are deprecated. `app.atmobb.authForum` is unchanged, so nobody re-consents.
- Operators: a minor release, and a backfill is required. Publish the two new schemas with `goat lex publish` and the three changed record schemas with `goat lex publish --update` (maintainers of the namespace only), rerun `appview/setup.sh` for the `atmobb_firsts` and `atmobb_stamp_awards` tables, the stamp collection, the new query, and the Lua, then run `appview/backfill.sh` so the rebuild fills both tables from history; until it runs nobody holds a first-post or by-hand stamp. The appview still keeps `atmobb_post_counts`; the app no longer reads it. Hosted tenants need no per-tenant step. [Happyview](docs/happyview.md#taking-stamps-to-production) has the order.

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
