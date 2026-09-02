# atmobb

atmobb brings phpBB-style forums to the AT Protocol. Boards, threads, signatures, avatars, post counts, rank ladders, a webring. The whole bit.

Public threads and replies live in their authors' atproto repos. The forum is an atproto account too, and its repo holds the boards, categories, staff grants, and moderation actions. atmobb indexes all of that back into something that looks like a forum. Member profiles work across atmobb forums and survive PDS migrations, which is most of the point.

## This is a hobby project

I built atmobb for myself, and it's offered as-is. There's no roadmap and no support. The next commit might change how something works, and I won't always announce it.

If you hit a bug, post about it on [atmobb.app](https://atmobb.app) and I'll take a look. Fork it, or just take it and rebuild it! Pull requests are welcome, and I'll read them, but I'm going to merge what fits the forum I want to run and pass on the rest. If you need something atmobb doesn't do, the fork is the answer, and the MIT license is there so you don't have to ask.

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
- [Plugins](docs/plugins.md): the narrow build-time integration built for the avatar builder
- [Forum theming](docs/theming.md): the custom CSS cascade, theme tokens, stable class hooks, and fonts
- [Lexicons](docs/lexicons.md): record schemas and publishing a forked namespace

## Fonts and avatars

The default UI uses Trebuchet MS, IBM Plex Sans, IBM Plex Mono, and Newsreader. Admins can upload licensed WOFF/WOFF2 files and CSS from the Appearance panel. Uploaded assets live in the forum account's PDS and keep their original license terms.

Profiles take image uploads and fall back to generated monograms. The built-in avatar lab crops photos into 100 × 100 old-school forum icons with skew, filters, chunky frames, and stamps; the finished image follows the member across any atmobb forum.

## License

atmobb is [MIT licensed](LICENSE). The bundled fonts retain [their SIL Open Font License 1.1 terms](THIRD_PARTY_LICENSES.md), and plugin dependencies and assets keep their own terms.

I used Claude Code and Amp Agent to write the code.
