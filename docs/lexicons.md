# Lexicons

`lexicons/app/atmobb/` defines atmobb's records, appview endpoints, and OAuth permission sets: threads, replies, boards, profiles, memberships, stamps, moderation actions, poll votes, and access requests. `lexicons/com/atproto/` holds vendored Bluesky schemas that exist purely for code generation. Don't publish those.

## Self-hosting

If you're self-hosting, you don't publish lexicons at all. The `app.atmobb.*` schemas are already on the network:

- `appview/setup.sh` asks Happyview to resolve and register each record collection.
- PDSes resolve `app.atmobb.authForum` to build the OAuth consent screen.
- Setup uploads query and procedure lexicons directly from this repository.

You only publish schemas if you're maintaining your own namespace or an incompatible fork.

Board watching added `app.atmobb.forum.watch` and gave `app.atmobb.authForum` one more permission: writing watch records. The grant that lets the forum ask atmo.pub for permission (`pub.atmo.notify.requestPermission`) is not in the set. A permission set may only carry methods under its own authority, and the PDS silently drops any other when it expands the include, so the login scope requests it directly as `rpc:pub.atmo.notify.requestPermission?aud=` followed by the relay DID and its `#notif_relay` fragment, percent-encoded. I publish both from the authority account, `goat lex publish` for the new record and `goat lex publish --update` for the set, before the release that uses them, because `setup.sh` resolves the record schema from the network and fails without it. Self-hosters still publish nothing. Existing sessions pick up the watch collection on refresh; the relay grant arrives with the member's next login, which the notifications switch triggers when it's missing.

Forum membership (join modes, invites, applications, sponsors) touched five schemas, all additively: `app.atmobb.moderation.action` gained the `acceptMember`, `revokeMember`, and `holdApplication` kinds plus optional `sponsor`, `via`, and `ref` fields; `app.atmobb.forum.profile` gained an optional `membership` object; `app.atmobb.forum.accessRequest` made `board` optional and added `forum`, so one record type carries both board requests and forum applications; `app.atmobb.forum.getAccessRequests` and `app.atmobb.moderation.getLog` gained parameters; and `app.atmobb.forum.getMembership` is new. The member permission set is unchanged, so nobody re-authorizes. Publish the three record schemas with `goat lex publish --update`; setup uploads the queries itself.

Stamps added two schemas and changed seven, all additively. `app.atmobb.forum.stamp` is a new record in the forum's repo and `app.atmobb.forum.getStamps` a new query. `app.atmobb.forum.membership` gained an optional `wearing` list, the stamp ids the member wears on that forum; `app.atmobb.moderation.action` gained the `awardStamp` and `revokeStamp` kinds and an optional `actor`, the staffer who acted when it isn't the signing forum; `app.atmobb.forum.profile` gained an optional `hideDefaultStamps` and marks `ranks` deprecated, kept so older records still validate and no longer rendered. `getMembers`, `getMembership`, `getThreadPage`, and `moderation.getLog` gained optional output fields, `getLog` gained a `stamps` family so awards do not crowd the moderation window, and the post-count fields they still carry are deprecated. The member permission set is unchanged, so nobody re-consents. Publish the two new schemas with `goat lex publish` and the three changed record schemas with `goat lex publish --update`, before setup runs, since setup resolves the stamp record from the network. Then rerun `appview/setup.sh` and `appview/backfill.sh`; [Happyview](happyview.md#taking-stamps-to-production) has the order.

[Extensions](extensions/README.md) added two schemas of atmoBB's own, both new records and both additive: `app.atmobb.extension.binding`, which thread an extension staff attached to, written only by the forum account; and `app.atmobb.extension.endorsement`, which repositories and release SHAs the atmobb.app directory forum's staff reviewed, written only by that one forum. Neither is a query Happyview indexes: both live only in the writing forum's own repo and are read straight from its PDS, so publishing them needs no `appview/setup.sh` rerun and no backfill, unlike stamps and membership. Publish both from the authority account with `goat lex publish` before the release that uses them. Neither touches `app.atmobb.authSysop` or `authForum`: an extension install asks for `repo:app.atmobb.extension.binding` as its own granular scope the moment any extension is installed, and the one forum running with `ATMOBB_EXTENSION_DIRECTORY=1` asks for `repo:app.atmobb.extension.endorsement` the same way, exactly like the watch collection's `rpc` scope above. An extension's own record schemas are a different thing entirely: they ship inside the extension's release, under the author's own NSID authority (their own domain, never `app.atmobb`), and atmoBB never publishes them for anyone.

Personal profile pages added one schema and changed four, all additively. `app.atmobb.actor.guestbook` is a new record in the signer's own repo: plain text of up to 300 graphemes and the owner it is addressed to. `app.atmobb.actor.profile` gained optional `profileSkin`, `banner`, `headline`, `currently`, `about`, and `panels`, plus the same fields as per-forum overrides in `#forumProfile`; `app.atmobb.forum.membership` gained optional `pinned` (up to four topics), `guestbook` (whether the guestbook is open), `guestbookClosed` (a list of `#closedPeriod`), `guestbookHidden`, and `guestbookBlocked`, which are public because the membership record is; `app.atmobb.forum.profile` gained an optional `hideProfileSkins`; and `app.atmobb.authForum` lists the guestbook collection. The new queries `app.atmobb.actor.getRegulars` and `app.atmobb.actor.getGuestbook` are uploaded by setup, and `app.atmobb.forum.getStamps` gained a `pinned` output field. Guestbook rules are enforced when the notes are read, not when they are written, so a note written straight to a PDS cannot skip them. Publish the guestbook record with `goat lex publish` and the four changed record schemas and the permission set with `goat lex publish --update`, before setup runs, since setup resolves the guestbook record from the network. Then rerun `appview/setup.sh`. `appview/backfill.sh` is optional, because no guestbook records exist yet. The member login scope also requests `repo:app.atmobb.actor.guestbook` directly, like the watch collection's `rpc` scope above, because a PDS may serve a cached copy of the permission set. The PDS caches client metadata for about 10 minutes, and members log in again before they can sign a guestbook.

## How resolution works

An NSID like `app.atmobb.discussion.thread` maps to `discussion.atmobb.app`. Resolution reads the `_lexicon.discussion.atmobb.app` TXT record, which contains `did=<authority DID>`, then fetches the `com.atproto.lexicon.schema` record whose rkey is the NSID from that DID's repo.

atmobb's authority is a dedicated account, `@lexicons.atmobb.app` (`did:plc:dqnwiguwsbb6uwrm7a2rsff2`). I keep the schemas off my personal account so that migrating or losing that account can't take the namespace with it.

DNS matching here is exact, not hierarchical. `_lexicon.atmobb.app` covers `app.atmobb.authForum` but does nothing for `app.atmobb.discussion.thread`. Every sub-namespace needs its own TXT record. I run seven of them.

## Changing a schema

Published schemas follow atproto's evolution rules. New fields are optional, existing types don't change, and a breaking change means a new NSID.

### Compact stamps and six choices

The stamp collection update adds optional `symbol` to `app.atmobb.forum.stamp#look` and raises `app.atmobb.forum.membership`'s `wearing` limit from three to six. Existing records remain valid. Before deploying the updated editor, the namespace maintainer must publish these two record schema updates, then rerun `appview/setup.sh` to refresh the record schemas, query output schemas, and Lua resolvers together. Self-hosters only rerun setup; they do not publish the shared namespace.

No database migration or backfill is needed. Members who have never chosen stamps still receive at most three automatic defaults. Check that six explicitly selected stamps survive a refresh and appear in the same order in posts, profiles, member lists, and hovercards. An old resolver will truncate the row to three, so do not deploy the editor ahead of the appview update.

### Update procedure

1. Edit the JSON in `lexicons/`, additive only.
2. Run `bun run lex` and `bun run check`.
3. Republish the changed schema to the authority repo with `goat lex publish --update <files>`. Same rkey, so it's an update, and without `--update` goat leaves existing records alone (it marks them 🟠 and moves on).
4. Rerun `appview/setup.sh` so instances re-resolve the record lexicons and pick up any query changes.

## Publishing your own namespace

An incompatible fork needs its own namespace and a domain the fork's maintainers control.

**1. Pick the namespace.** `app.atmobb.*` maps to `atmobb.app`. `net.example.forum.*` maps to `forum.example.net`.

**2. Create an authority account.** A dedicated atproto account with a handle under the domain, something like `@lexicons.forum.example.net`.

**3. Add DNS records.** One `_lexicon` TXT record per namespace level, each containing `did=<authority DID>`. atmobb needs seven: the base namespace plus `actor`, `discussion`, `forum`, `moderation`, `poll`, and `richtext`. Check them with `goat lex check-dns lexicons/...` before you publish anything.

**4. Rename the NSIDs.** Replace every `app.atmobb` ID and schema reference across `src/`, `lexicons/`, and `appview/`, then run `bun run lex` to regenerate the typed clients.

**5. Publish.** With [goat](https://github.com/bluesky-social/indigo/tree/main/cmd/goat) logged in as the authority account:

```sh
goat lex publish lexicons/app/atmobb/**/*.json lexicons/app/atmobb/*.json
```

Each schema lands as a `com.atproto.lexicon.schema` record with the NSID as its rkey. Include the permission sets. Leave out `lexicons/com/atproto/`. Confirm it worked with `goat lex resolve <your-nsid>`.

**6. Don't break it later.** Once a schema is published, additive changes only.

> [!WARNING]
> Publishing a lexicon is close to permanent. Other people's records get shaped by it and other appviews index against it, so a breaking change means a brand new NSID plus a migration for everyone downstream. Read your schemas properly before the first `goat lex publish`.
