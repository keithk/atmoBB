# atmobb

atmobb brings phpBB-style forums to the AT Protocol. Boards, threads, signatures, avatars, post counts, rank ladders, a webring. The whole bit.

Public threads and replies live in their authors' atproto repos. The forum is an atproto account too, and its repo holds the boards, categories, staff grants, and moderation actions. atmobb indexes all of that back into something that looks like a forum. Member profiles work across atmobb forums and survive PDS migrations, which is most of the point.

## The lexicons are the forum

Everything atmobb does runs on eleven published record types under `app.atmobb.*`. A thread is a record in the author's repo that points at a board. A board is a record in the forum's repo. A member's profile is one record that follows them to every forum on the network. The schemas resolve from a dedicated authority account, and anyone can read them, index them, or write to them.

atmobb the software is one way to run a forum on those records. You don't have to use it.

- **Run your own forum with this code.** Self-host it and you publish nothing. Your forum shows up in the directory and the webring, your members arrive with the profiles and post counts they already have, and any board you give a topic slug merges threads with every other board in the atmosphere on that topic. Skip the topic and your forum stays its own place that happens to share members with everyone else.
- **Build a different client for the same records.** Nothing in the schemas says SvelteKit or phpBB. A phone app, a text-mode reader, a bot that mirrors a board to email, a forum that looks nothing like this one. If it reads or writes `app.atmobb.discussion.thread` records, it's on the same network, and its posts show up here.
- **Fork the whole thing.** Pick your own namespace, publish your own schemas, and run a separate network that has never heard of atmobb. [Lexicons](docs/lexicons.md) walks through it.

You choose how connected to be, and you can choose it board by board. Topic federation is open, allowlisted, or off. Members-only boards skip the public index entirely. An operator can delist a forum from every cross-forum surface with one database row. Whatever you pick, a member's posts stay in their own repo, and they come along when that member migrates PDSes.

I built atmobb for myself and it's offered as-is. There's no roadmap and no support, and the next commit might change how something works. If you hit a bug, post about it on [atmobb.app](https://atmobb.app) and I'll take a look. The beauty of the whole project is that if you want something different, you can just build it. I want to see a bunch of weird variations out there, forums shaped around exactly what Brazil needs, you know?

## Local quick start

You need Bun 1.4+, Node.js 22.19+, Docker with Compose v2, `git`, `curl`, `jq`, `openssl`, internet access, and an atproto account. Swap in your own handle:

```sh
git clone https://github.com/keithk/atmoBB.git atmobb
cd atmobb
bun install --frozen-lockfile

# Pull the pinned upstream Happyview image and start it with Postgres.
docker compose up -d

# Resolve your handle, create the Happyview admin key, and configure the index.
export ADMIN_HANDLE=alice.bsky.social
export ADMIN_DID="$(curl --fail --silent --show-error --get \
  --data-urlencode "handle=$ADMIN_HANDLE" \
  https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle | jq -er .did)"
ADMIN_DID="$ADMIN_DID" sh appview/bootstrap-admin.sh > .env
chmod 600 .env
sh appview/setup.sh

# Add synthetic forum content and start the web app.
RESET=1 ADMIN_DID="$ADMIN_DID" bun appview/seed-dev.ts
bun run dev
```

`setup.sh` has to end with `== done`. Then open **http://127.0.0.1:5173**.

> [!CAUTION]
> **Log in with a test account, not your main one.**
>
> The forum data is local. Your identity is not. Posts, profile changes, memberships, and access requests get written to the real atproto repo of whatever account you log in with, and anyone watching the firehose can index them. There is no offline mode that fakes this part.
>
> Making a throwaway account takes a minute. It saves you from explaining stray test records in your main repo later.

See [Local development](docs/development.md) for verification, teardown, and troubleshooting.

## Architecture

- **App** (`src/`): SvelteKit with adapter-node. It reads from the appview over XRPC and writes to members' PDSes and the forum account's PDS with its own OAuth client.
- **Appview**: [Happyview](https://github.com/gamesgamesgamesgamesgames/happyview), a Rust and Postgres atproto appview engine. It eats Jetstream, indexes registered `app.atmobb.*` collections, and serves queries written in Lua. atmobb runs a pinned upstream image with no patches.
- **Postgres**: Happyview's record storage, plus atmobb's derived thread and post-count tables.

A public reply takes a lap before anyone else sees it: app to the author's PDS, PDS to the firehose, firehose to Jetstream, Jetstream to Happyview. Experimental members-only boards skip that entire trip and use Happyview permissioned spaces instead, so their content never lands in a public repo.

## Documentation

- [Features](docs/features.md): everything the forum does, member features through operator tools
- [Local development](docs/development.md): prerequisites, setup, verification, reset, and troubleshooting
- [Self-hosting](docs/self-hosting.md): a full production deployment, systemd and TLS included
- [Happyview](docs/happyview.md): the appview architecture, the image pin, setup, and backfill
- [Hosted tenants](docs/hosted-tenants.md): running other people's forums on one shared appview
- [Members-only boards](docs/private-boards.md): privacy boundaries and permissioned spaces
- [Forum theming](docs/theming.md): the custom CSS cascade, theme tokens, stable class hooks, and fonts
- [Lexicons](docs/lexicons.md): record schemas and publishing a forked namespace

## Fonts and avatars

The default UI uses Trebuchet MS, IBM Plex Sans, IBM Plex Mono, and Newsreader. Admins can upload licensed WOFF/WOFF2 files and CSS from the Appearance panel. Uploaded assets live in the forum account's PDS and keep their original license terms.

Profiles take image uploads and fall back to generated monograms. The built-in userpic maker crops photos into 100 × 100 old-school forum icons with an optional simple border; the finished image follows the member across any atmobb forum. The avatar is an ordinary blob on the profile record, so other apps the member authorizes can set it too.

## License

atmobb is [MIT licensed](LICENSE). The bundled fonts retain [their SIL Open Font License 1.1 terms](THIRD_PARTY_LICENSES.md), and uploaded assets keep their own terms.

I used Claude Code and Amp Agent to write the code.
