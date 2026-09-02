# Lexicons

`lexicons/app/atmobb/` defines atmobb's records, appview endpoints, and OAuth permission sets: threads, replies, boards, profiles, memberships, moderation actions, poll votes, and access requests. `lexicons/com/atproto/` holds vendored Bluesky schemas that exist purely for code generation. Don't publish those.

## Self-hosting

If you're self-hosting, you don't publish lexicons at all. The `app.atmobb.*` schemas are already on the network:

- `appview/setup.sh` asks Happyview to resolve and register each record collection.
- PDSes resolve `app.atmobb.authForum` to build the OAuth consent screen.
- Setup uploads query and procedure lexicons directly from this repository.

You only publish schemas if you're maintaining your own namespace or an incompatible fork.

## How resolution works

An NSID like `app.atmobb.discussion.thread` maps to `discussion.atmobb.app`. Resolution reads the `_lexicon.discussion.atmobb.app` TXT record, which contains `did=<authority DID>`, then fetches the `com.atproto.lexicon.schema` record whose rkey is the NSID from that DID's repo.

atmobb's authority is a dedicated account, `@lexicons.atmobb.app` (`did:plc:dqnwiguwsbb6uwrm7a2rsff2`). I keep the schemas off my personal account so that migrating or losing that account can't take the namespace with it.

DNS matching here is exact, not hierarchical. `_lexicon.atmobb.app` covers `app.atmobb.authForum` but does nothing for `app.atmobb.discussion.thread`. Every sub-namespace needs its own TXT record. I run seven of them.

## Changing a schema

Published schemas follow atproto's evolution rules. New fields are optional, existing types don't change, and a breaking change means a new NSID.

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
