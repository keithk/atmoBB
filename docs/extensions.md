# Extensions

An extension is TypeScript compiled to WebAssembly and run inside atmoBB as an [Extism](https://extism.org) plug-in, one sandboxed instance per install. It reaches the host only through the capabilities an admin granted it at install: a private key/value store, records in its own collections, scheduled timers, and notifications. It never sees the forum's session, another install's data, or anything outside the payloads atmoBB hands it. This is how something like a multiplayer game can run on a forum, its own panel and its own records, without becoming part of atmoBB itself.

## Writing an extension

### Quick start

The kit isn't on npm yet, so build it from `extension-kit/` in this repository once, then use `atmobb-extension` from wherever you're writing your extension:

```sh
cd extension-kit
bun install                     # also builds the CLI into lib/
node lib/cli/index.mjs new ~/code/my-extension
cd ~/code/my-extension
npm install
npm run dev
```

`new` starts you from a counter template that touches k/v, a record bound to a thread, a timer, and a panel. `npm run dev` builds it, rebuilds on every change, and prints the `file://` URL to install. On a dev forum running with `ATMOBB_EXTENSIONS_DEV=1`, install once from `/admin/extensions` with that URL; after each rebuild, open the install's page, re-read the local project, and confirm the update. Local installs are refused without that env var.

To ship a release, build for real (`npm run build`), commit `dist/`, and tag the commit, like `v0.1.0`. atmoBB installs a git tag whose tree holds a built `dist/`; an admin points **Admin → Extensions** at your repository's `https://` URL and picks the tag.

### The manifest

`manifest.json` at the project root:

| field | what it is |
| --- | --- |
| `id` | Shown to admins at review. Never used for paths or routes. |
| `name`, `version` | Your extension's own name and release version, each up to 100 characters. |
| `hostApi` | The host API version you're built against, as `major.minor`. See below. |
| `dataVersion` | The version of your stored data. Raise it when a release needs `migrate` to run first. |
| `collections` | NSIDs you write to the forum's repo. Each needs a shipped record lexicon. Up to 16. |
| `capabilities` | Any of `kv`, `records`, `timers`, `notify`. |
| `ui.entry` | Repository-relative path to your panel's HTML, like `ui/index.html`. Optional; without it you have no panel. |
| `lexicons` | Repository-relative paths to the lexicon JSON files you ship: up to 32 files, 64 KB each. |

### Host API version

atmoBB currently offers host API `1.0`. Your `hostApi` must share its major version exactly, and its minor version can't be higher than what atmoBB offers: a `1.2` extension refuses to install against a `1.0` host, but a `1.0` extension installs fine against a `1.2` host. A major bump means a host function was removed or renamed; a minor bump means one was added.

### Admission

At install and every update, atmoBB checks the manifest and lexicons before fetching anything into place:

- Every declared collection needs a lexicon in `lexicons` whose `main` definition is a `record`, with refs that resolve inside your shipped lexicons, no more than 8 deep.
- Every declared collection must share one NSID authority. `com.example.counter.tally` and `com.example.counter.log` are fine together; mixing authorities isn't.
- That authority can't be `app.atmobb`, `com.atproto`, `app.bsky`, `chat.bsky`, `tools.ozone`, or `pub.atmo`, and no declared collection can be one the forum account's own login already covers (staff grants, bans, the forum profile, threads, stamps, and the rest of `authSysop`/`authForum`). Extensions can't touch any of that.
- The `repo:<collection>` scope text your collections add to the forum's login tops out at 1024 characters.
- The first repository to declare a collection claims it permanently. A different repository declaring the same collection later is refused. See [Claims](#claims).

When your authority publishes its lexicons (see [Lexicons](lexicons.md)), review also compares what you shipped against what's published, and refuses a release whose schema differs from the published one. Publishing nothing isn't a refusal by itself, just a note at review that the shapes couldn't be checked.

### Capabilities and their limits

Every host call needs its capability granted in the manifest; an ungranted call throws a `HostCallError` with `code: 'capability_not_granted'`. Every call, granted or not, runs under one budget: `ATMOBB_EXTENSIONS_CALL_TIMEOUT_MS` (5 s default) wall clock including host I/O, `ATMOBB_EXTENSIONS_MEMORY_PAGES` (1024 default, 64 MiB) of guest memory, `ATMOBB_EXTENSIONS_CALL_HOST_CALLS` (100) host calls, `ATMOBB_EXTENSIONS_CALL_ARG_BYTES` (256 KB) sent to the host, `ATMOBB_EXTENSIONS_CALL_RETURN_BYTES` (1 MB) returned to the guest plus the handler's own output, and `ATMOBB_EXTENSIONS_HOST_IO_MS` (3 s, capped at 80% of the call timeout) spent waiting on host functions. Going past any of these fails the call. An install's instance closes after 5 minutes idle and cold-starts on its next call.

**`kv`**: a private JSON store per install, namespaced so installs never see each other's keys.

```ts
kv.get<T>(key)
kv.set(key, value)
kv.delete(key)
kv.list(prefix, { limit, cursor })
```

Caps: `ATMOBB_KV_MAX_KEYS` (500) keys, `ATMOBB_KV_MAX_KEY_LENGTH` (200 characters), `ATMOBB_KV_MAX_VALUE_BYTES` (64 KB) per value, `ATMOBB_KV_MAX_STORE_BYTES` (256 KB) for the whole store, `ATMOBB_KV_MAX_WRITES_PER_MINUTE` (60) sets and deletes a minute. The store survives disable and lives 30 days past uninstall before a purge removes it.

**`records`**: create, put, delete, get, and list records in your declared collections, always written to the forum's repo as the forum account.

```ts
records.create({ collection, rkey?, record })
records.put({ collection, rkey, record })
records.delete({ collection, rkey })
records.get({ repo, collection, rkey })
records.list({ repo, collection })
```

Writes are capped at `ATMOBB_EXTENSIONS_RECORD_WRITES_PER_HOUR` (100) an hour per install, and the record has to validate against your shipped lexicon. Reads may name any repo, but only a collection you've declared, and page through up to 10 pages of 100 before coming back `truncated: true`. Records you've published stay in the forum's repo even after you're uninstalled.

**`timers`**: scheduled calls to your `timer` handler.

```ts
timers.set({ name, at, payload? })  // ISO 8601; replaces a pending timer with the same name
timers.cancel(name)
```

`at` has to be at least `ATMOBB_EXTENSIONS_TIMER_MIN_DELAY_MS` (60 s) from now, and an install may have at most `ATMOBB_EXTENSIONS_TIMER_CAP` (200) pending. A poller checks every 30 seconds; delivery is at least once, so a `timer` handler has to tolerate a repeat. A failed dispatch retries with backoff starting at a minute and doubling up to an hour; a timer whose install is gone or disabled is dropped rather than fired or retried.

**`notify`**: send to members who turned notifications on.

```ts
notify({ to, title, message, link? })  // up to 50 DIDs; the host prefixes your extension's name to the title
```

`ATMOBB_EXTENSIONS_NOTIFY_PER_RECIPIENT_PER_DAY` (5) and `ATMOBB_EXTENSIONS_NOTIFY_PER_INSTALL_PER_DAY` (100) cap sends; title and message are cut to 100 and 500 characters. A `link` has to be a path on the forum. Recipients who haven't opted in, or aren't in open or member standing, are skipped without saying which.

### Handlers

`src/index.ts` exports `defineExtension({ ... })` from the kit's runtime. Handlers run synchronously: no `async`, no returned Promises.

- **`action(input)`**, required. `input` is `{ viewer, thread, action, input }`; `thread` is the bound thread the call came from, or `null` on a standalone page. Whatever you return (any JSON) goes back to the panel.
- **`attach(input)`**, optional. Staff attached you to a thread; `input` is `{ viewer, thread, input }`, with `input.input` whatever your attach form collected. Throwing refuses the attach, and atmoBB removes the binding it already wrote. Without this handler you can never be attached to a thread.
- **`timer({ name, at, payload })`**, optional. A `timers.set` call came due.
- **`openWork()`**, optional, returns a boolean. Whether there's work in progress an admin should know about before disabling or uninstalling you.
- **`migrate({ from, to })`**, optional. Runs once, before an update takes effect, when the new release's `dataVersion` is higher than the version your stored data is at. Throwing keeps the previous release active.

### Panels

`ui.entry` is your panel's HTML page, shown in a sandboxed frame: on a thread you're bound to, on your own standalone page at `/ext/<repository host and path>` (optionally with a page inside it after `/-/`, like `/ext/git.example/jack/diplomacy/-/games/spring-1901`), and on the page staff use to attach you. That address follows your repository, not your install, so a link keeps working after a reinstall.

The frame is sandboxed to scripts only: no access to the forum page, its cookies, or its session, no `fetch`, no forms, no popups, no workers, and it loads scripts, styles, images, and fonts only from your own UI directory. Scripts must be classic (`<script src="panel.js" defer>`), not modules. Kept file types: `.html` (the entry only), `.js`, `.css`, `.svg`, `.png`, `.webp`, `.woff2`, `.json`. A panel that navigates itself away from its page is torn down.

The panel and the page trade `postMessage`s in bridge version 1, every message carrying `v: 1`:

| direction | message |
| --- | --- |
| panel → page | `{ type: 'atmobb:action', v: 1, id, action, input }` runs your `action` handler as the viewer |
| panel → page | `{ type: 'atmobb:resize', v: 1, height }` sizes the frame, clamped to 48 to 2400px |
| panel → page | `{ type: 'atmobb:attach', v: 1, params }` (attach page only) attaches with this setup |
| page → panel | `{ type: 'atmobb:init', v: 1, mode, thread, signedIn, path }` once, on load; `mode` is `thread`, `page`, or `attach` |
| page → panel | `{ type: 'atmobb:result', v: 1, id, ok, value }` or `{ ..., ok: false, error: { code, message } }`, answering an action |

Post to `parent` with target origin `'*'` (the frame's own origin is opaque) and accept only messages whose `event.source` is `parent`; the template's `ui/panel.js` already does this. Action names top out at 128 characters, message ids at 64, and action input or attach params at 64 KB of JSON; a panel can have at most 8 actions waiting on the server at once.

On a thread, only signed-in members can run actions. On your standalone page, signed-out visitors can too, counted per client address (see [self-hosting](self-hosting.md#extensions) for `ADDRESS_HEADER`/`XFF_DEPTH`, which that count depends on behind a proxy). Signed-in actions are capped at `ATMOBB_EXTENSIONS_ACTIONS_PER_VIEWER_PER_MINUTE` (30) per viewer per install and `ATMOBB_EXTENSIONS_ACTIONS_PER_INSTALL_PER_MINUTE` (300) per install; signed-out actions share `ATMOBB_EXTENSIONS_ANONYMOUS_ACTIONS_PER_INSTALL_PER_MINUTE` (60) across every address, one running at a time per install.

### What an extension can see

`action` and `attach` are told the viewer's DID (or `null` signed out), their standing on this forum, whether they're staff, and whether they're banned. Never a session, a cookie, or credentials of any kind. On a bound thread, `thread.uri` is the at-uri of the thread it's running in. Extensions only ever attach to threads on public boards, because everything they publish is public too.

### The extension log

`console.log`, `warn`, and the rest, plus your handlers' thrown errors, go to a small per-install log: the last 200 lines, each cut to 500 characters, readable by this forum's admins on the install's page. Nothing you don't log reaches it, and nothing in it reaches anywhere else. Don't log anything private; the log isn't access-controlled beyond "admins of this forum."

## Installing and running extensions

**Admin → Extensions** installs, updates, and manages extensions. It needs `ATMOBB_EXTENSIONS` unset (or anything but `off`) and this process holding the extensions lock (see [self-hosting](self-hosting.md#extensions)); otherwise the page says so and refuses changes.

### Install review

Enter a repository's `https://` URL and, optionally, a tag; atmoBB fetches the tag (or the latest release tag if you leave it blank), admits the manifest, and shows the admin:

- the records it would publish, all under one NSID authority, and whether that authority's published lexicons match what's shipped: **Verified** (they match), **Unpublished** (nothing to check against), or refused outright if they differ;
- one of three trust marks: **Unverified extension** (the atmobb.app directory hasn't endorsed this repository; you can still install it, but only if you trust who publishes it), **Endorsed repository** (the directory endorses the repository but hasn't reviewed this exact release), or **Trusted** (the directory endorses the repository and reviewed this exact release);
- what it can do, from its declared capabilities;
- what it can see: the account (DID) of every signed-in member who opens a thread it's attached to, and whether they're a member, staff, or banned here.

Confirming claims the collections, moves the bundle into place, and installs it active. An update shows the same review plus a diff against the manifest currently running: added or removed collections and capabilities, a host API bump, and whether stored data needs a `migrate`.

### Reconnecting the forum account

Installing or updating an extension that declares new collections widens the OAuth scope the forum account's login needs. Reconnect from **Admin → Connection** afterwards; the page names which collections are missing. The forum account's PDS can cache the old permission set for about 10 minutes, so if the consent screen doesn't list the new collections yet, wait a few minutes and reconnect again.

### Updates, rollback, and migrate

**Admin → Extensions → an install** lists version tags newer than the one running, and any tag already run whose commit has since changed underneath it. Staging and applying an update works like install: review, then confirm. If the new release's `dataVersion` is higher, its `migrate` handler runs against the install's stored data before it switches over; if `migrate` throws, the previous release stays active and nothing moves.

Rollback switches an install back to a release it has run before, as long as that release's bundle is still on disk and its recorded `dataVersion` still matches what's currently active. A successful `migrate` forecloses rolling back past it, since the data it converted is no longer at the old version.

### Disabling and uninstalling

Disable stops an install from running; enable turns it back on. Both, and uninstall, first ask the install's `openWork` handler, if it has one, whether there's work in progress; if it says yes, atmoBB refuses and the page offers to **force** it through instead. Uninstalling also removes the install's bundles; its k/v store and pending timers survive for 30 days in case of a reinstall, then a daily purge removes them. Records it already published, and its collection claims, are never touched by uninstalling.

### Claims

The first repository to declare a collection owns it permanently, across reinstalls, so a different repository can never quietly take over records already sitting in the forum's repo. Uninstalling an extension doesn't release its claims. **Admin → Extensions** lists claims with no installed extension behind them and lets an admin release one by hand, after confirming, but only when no installed extension still declares it.

### Attaching to a thread

Staff who moderate the whole forum can attach an extension to a thread from the thread page, if the extension exports `attach` and the thread sits on a public board. Members-only boards are out, since everything an extension publishes is public. atmoBB writes the binding record itself, an `app.atmobb.extension.binding` in the forum's own repo, a collection extensions can never write to themselves, then calls the extension's `attach` handler with the setup its form collected. A refusal there removes the binding again. One extension per thread; a thread already bound refuses another attach.

### The kill switch

Set `ATMOBB_EXTENSIONS=off` to turn every extension off, forum-wide: no calls, no panels, no timers, nothing added to the login scope, and **Admin → Extensions** refuses changes. Anything else, including leaving it unset, is on.
