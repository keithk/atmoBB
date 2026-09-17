# Extensions

> [!WARNING]
> Extensions are alpha. The host API, the manifest rules, the panel bridge, and the authoring kit can all still change between atmoBB releases, and an extension you ship today may need edits to keep installing. It hasn't run on a production forum yet. If something breaks, reads wrong, or stops you from building what you're trying to build, post it on the [Bugs board](https://atmobb.app/b/3mqdahz5y4m2f) on atmobb.app. See [Reporting problems](#reporting-problems) for what to include.

An extension is a small program a forum admin installs from a git URL. It runs inside atmoBB in a sandbox, with no filesystem, no network, and no access to the forum's session or credentials. It can keep private state, publish public records to the forum's repo, run on a schedule, send notifications, and show a panel on threads staff attach it to or on a page of its own. That's enough for something like a multiplayer game to live on a forum, with its own board and its own records, without becoming part of atmoBB itself.

[How an extension works](#how-an-extension-works) covers the model. [Writing an extension](#writing-an-extension) takes you from a clone to a running panel, then lists everything you can use. [Installing and running extensions](#installing-and-running-extensions) is for forum admins.

## How an extension works

You write `src/index.ts` in TypeScript against the [extension kit](../extension-kit/README.md). `npm run build` bundles it, compiles it with the pinned [Extism](https://extism.org) JS compiler, and writes `dist/`. atmoBB runs that WebAssembly as an Extism plug-in, one sandboxed instance per install. You never touch WebAssembly yourself.

An extension does nothing on its own. Your module exports handlers, and atmoBB calls them:

- `action` when someone presses something in your panel. The panel posts a message to the forum page, the forum calls `action` as that viewer, and whatever you return goes back to the panel.
- `attach` when staff attach you to a thread.
- `timer` when a timer you set comes due.
- `migrate` once, before an update whose `dataVersion` is higher than your stored data's.
- `openWork` when an admin is about to disable or uninstall you, to ask whether you're mid-game.

Handlers run synchronously, one call at a time per install, each under a time, memory, and host-call budget. Between calls your instance may be thrown away; anything you want to keep goes through a host call.

Inside a handler you reach the forum through `kv`, `records`, `timers`, and `notify` from the kit. Each is a capability an admin grants at install, from the list in your manifest, and a call without its capability throws. Everything else, from the viewer's DID to the thread you're on, arrives in the handler's input.

Private state goes in a key/value store only your install can read, capped at a few hundred kilobytes. Public data goes in records that atmoBB writes to the forum's own repo, as the forum account, in collections you declare under an NSID authority you control, validated against lexicons you ship. That's the same shape every other record on the atmosphere has, so anyone can read your records from the forum's repo, and they stay there after you're uninstalled.

Your panel, `ui/index.html` and the files beside it, runs in a sandboxed frame that can load nothing else. It can't see the forum page, its cookies, or its session, and it can't fetch anything. It talks to the forum page over `postMessage` in a small fixed set of messages, and the forum page relays actions to your handler. The forum draws your extension's name, a trust mark, and any link you ask for outside the frame, where your panel can't imitate them.

An admin installs you by pointing **Admin → Extensions** at your repository and a release tag. atmoBB fetches the tag, checks the manifest and lexicons, and shows the admin what you'd publish, what you can do, and what you can see, before anything is installed. Updates go through the same review, and an install can be rolled back, disabled, or uninstalled.

## Writing an extension

### Before you start

- Node 22.19 or newer on macOS (arm64 or x64) or Linux (x64 or arm64). There's no Windows build of the compiler.
- Bun or npm, to build the kit.
- A clone of atmoBB. The kit isn't on npm yet, so you build it from `extension-kit/` in this repository.
- The network, once. The first build downloads the pinned `extism-js` and binaryen into `~/.cache/atmobb-extension-kit` (or `ATMOBB_EXTENSION_KIT_CACHE`).
- A forum to install on. Follow [Local development](development.md) to run atmoBB at `http://127.0.0.1:5173` with an admin account connected. You'll start it with one extra environment variable, below.

### Quick start

Build the kit once, then scaffold a project anywhere:

```sh
git clone https://github.com/keithk/atmoBB.git
cd atmoBB/extension-kit
bun install                     # or npm install; also builds the CLI into lib/
node bin/atmobb-extension.mjs new ~/code/my-extension
cd ~/code/my-extension
npm install
npm run build
```

`new` copies a starter template: a counter that staff attach to a thread, members press a button in the thread's panel, and a timer resets a day later. It touches every part of the host API an extension usually needs. The project it creates is small:

| file | what it is |
| --- | --- |
| `manifest.json` | What you declare to the forum and what an admin reviews: name, version, collections, capabilities, panel entry, lexicon files. See [The manifest](#the-manifest). |
| `src/index.ts` | The extension itself: `export default defineExtension({ ... })`. See [Handlers](#handlers). |
| `lexicons/` | One record schema per collection you declare. See [Lexicons](lexicons.md) for the format. |
| `ui/` | The panel: `index.html`, `panel.js`, `panel.css`. See [Panels](#panels). |
| `dist/` | What `npm run build` writes: `manifest.json`, `extension.wasm`, your lexicons, and the files beside `ui.entry`. This is what a forum installs, so it gets committed. |

The scaffolded `package.json` runs the kit out of `node_modules/`, so `npm run build` and `npm run dev` work from the project; `atmobb-extension` never needs to be on your PATH.

Change `com.example.counter` before you install anywhere. It appears in `manifest.json`, in `lexicons/com.example.counter.tally.json` (rename the file to match), and in `src/index.ts`. Use an NSID authority you control, which is a domain you own written backwards, like `com.yourname.counter`. The first repository to install a collection on a forum claims it there permanently (see [Claims](#claims)), so shipping the placeholder locks `com.example.counter.tally` to you on that forum and refuses it to everyone after.

Then run it against your dev forum:

```sh
npm run dev            # atmobb-extension dev [--forum http://127.0.0.1:5173]
```

`dev` builds, rebuilds on every change, and prints the `file://` URL to install. On the forum:

1. Start atmoBB with `ATMOBB_EXTENSIONS_DEV=1`. Local `file://` installs are refused without it.
2. Signed in as an admin, open `/admin/extensions`, paste the URL `dev` printed as the Git URL, and confirm the review.
3. Reconnect the forum account. Installing an extension that declares collections widens the OAuth scope the forum's login needs; **Admin → Extensions** lists the missing collections and links to the reconnect. Until you do this, every record your extension writes fails, and the template's `attach` writes one. The forum account's PDS can remember the old permissions for about 10 minutes, so if the consent screen doesn't list your collection yet, wait and reconnect again. See [Reconnecting the forum account](#reconnecting-the-forum-account).
4. Open a thread on a public board and attach the extension from the thread page. Its panel appears on the thread.
5. After each rebuild, open the install's page under **Admin → Extensions**, press **re-read the local project**, and confirm the update. Your handlers' `console.log` output and thrown errors show in the extension log on that page.

### A complete extension

The whole extension is one module. This is the shape the template uses; the [kit README](../extension-kit/README.md#the-author-api) has the full author API. For a real one to read next, [examples/dice](../examples/dice/README.md) is a dice roller for play-by-post threads: one lexicon, one capability, two actions, and a panel that is a text field and a list.

```ts
import { defineExtension, kv, records, timers, refuse } from 'atmobb-extension-kit';

const TALLY = 'com.example.counter.tally';

export default defineExtension({
  // Staff attached the counter to a thread. `input` is what the attach form sent.
  attach({ thread, input }) {
    const { start = 0 } = (input ?? {}) as { start?: unknown };
    if (typeof start !== 'number') refuse('Start must be a number.', 'bad_start');
    const { uri } = records.create({ collection: TALLY, record: { $type: TALLY, thread: thread.uri, count: start, updatedAt: new Date().toISOString() } });
    kv.set(`thread:${thread.uri}`, { count: start, tally: uri.split('/').pop() });
    return { count: start };
  },

  // A member pressed something in the panel. Whatever you return goes back to it.
  action({ viewer, thread, action }) {
    if (!thread) refuse('The counter only runs in a thread.', 'not_in_thread');
    const counter = kv.get<{ count: number; tally: string }>(`thread:${thread.uri}`);
    if (!counter) refuse("The counter isn't set up for this thread.", 'not_set_up');
    if (action !== 'increment') return { count: counter.count };
    if (!viewer.did) refuse('Sign in to count.', 'sign_in');
    const count = counter.count + 1;
    kv.set(`thread:${thread.uri}`, { ...counter, count });
    records.put({ collection: TALLY, rkey: counter.tally, record: { $type: TALLY, thread: thread.uri, count, updatedAt: new Date().toISOString() } });
    timers.set({ name: `reset:${thread.uri}`, at: new Date(Date.now() + 86_400_000).toISOString(), payload: { thread: thread.uri } });
    return { count };
  },

  // A timer came due.
  timer({ payload }) {
    const { thread } = payload as { thread: string };
    const counter = kv.get<{ count: number; tally: string }>(`thread:${thread}`);
    if (counter) kv.set(`thread:${thread}`, { ...counter, count: 0 });
  },
});
```

The default export is the extension; a named export won't build. `action` is required, the rest are optional. Handlers are synchronous: no `async`, no returned Promises.

### The manifest

`manifest.json` at the project root:

| field | what it is |
| --- | --- |
| `id` | Shown to admins at review. Never used for paths or routes. Up to 100 characters. |
| `name`, `version` | Your extension's own name and release version, each up to 100 characters. |
| `hostApi` | The host API version you're built against, as `major.minor`. See below. |
| `dataVersion` | The version of your stored data. Start at `1`; raise it when a release needs `migrate` to run first. |
| `collections` | NSIDs you write to the forum's repo. Each needs a shipped record lexicon. Up to 16. |
| `capabilities` | Any of `kv`, `records`, `timers`, `notify`. |
| `ui.entry` | Repository-relative path to your panel's HTML. It has to sit in a directory of its own, like `ui/index.html`, since the release carries every servable file beside it. Optional; without it you have no panel. |
| `lexicons` | Repository-relative paths to the lexicon JSON files you ship: up to 32 files, 64 KB each. |

Every field but `ui` is required. An extension that writes no records still needs `"collections": []` and `"lexicons": []`, and one that calls no host functions still needs `"capabilities": []`. `npm run build` fails before compiling if atmoBB would refuse the manifest, so you find out at your desk, not at review.

### Host API version

atmoBB currently offers host API `1.0`. Your `hostApi` must share its major version exactly, and its minor version can't be higher than what atmoBB offers: a `1.2` extension refuses to install against a `1.0` host, but a `1.0` extension installs fine against a `1.2` host. A major bump means a host function was removed or renamed; a minor bump means one was added. While extensions are alpha, expect bumps.

### Admission

At install and every update, atmoBB checks the manifest and lexicons before fetching anything into place:

- Every declared collection needs a lexicon in `lexicons` whose `main` definition is a `record`, with refs that resolve inside your shipped lexicons, no more than 8 deep.
- Every declared collection must share one NSID authority. `com.example.counter.tally` and `com.example.counter.log` are fine together; mixing authorities isn't.
- That authority can't be `app.atmobb`, `com.atproto`, `app.bsky`, `chat.bsky`, `tools.ozone`, or `pub.atmo`, and no declared collection can be one the forum account's own login already covers (staff grants, bans, the forum profile, threads, stamps, and the rest of `authSysop`/`authForum`). Extensions can't touch any of that.
- The `repo:<collection>` scope text your collections add to the forum's login tops out at 1024 characters.
- The first repository to declare a collection claims it permanently. A different repository declaring the same collection later is refused. See [Claims](#claims).

When your authority publishes its lexicons (see [Lexicons](lexicons.md)), review also compares what you shipped against what's published, and refuses a release whose schema differs from the published one. Publishing nothing isn't a refusal by itself, just a note at review that the shapes couldn't be checked.

### Capabilities and their limits

Every host call needs its capability granted in the manifest; an ungranted call throws a `HostCallError` with `code: 'capability_not_granted'`. Every call, granted or not, runs under one budget: `ATMOBB_EXTENSIONS_CALL_TIMEOUT_MS` (5 s default) wall clock including host I/O, `ATMOBB_EXTENSIONS_MEMORY_PAGES` (1024 default, 64 MiB) of guest memory, `ATMOBB_EXTENSIONS_CALL_HOST_CALLS` (100) host calls (`ATMOBB_EXTENSIONS_MIGRATE_HOST_CALLS` (2000) for a `migrate` call), `ATMOBB_EXTENSIONS_CALL_ARG_BYTES` (256 KB) sent to the host, `ATMOBB_EXTENSIONS_CALL_RETURN_BYTES` (1 MB) returned to the guest plus the handler's own output, and `ATMOBB_EXTENSIONS_HOST_IO_MS` (3 s, capped at 80% of the call timeout) spent waiting on host functions. Going past any of these fails the call. An install's instance closes after 5 minutes idle and cold-starts on its next call.

**`kv`**: a private JSON store per install, namespaced so installs never see each other's keys.

```ts
kv.get<T>(key)
kv.set(key, value)
kv.delete(key)
kv.list(prefix, { limit, cursor })
```

Caps: `ATMOBB_KV_MAX_KEYS` (500) keys, `ATMOBB_KV_MAX_KEY_LENGTH` (200 characters), `ATMOBB_KV_MAX_VALUE_BYTES` (64 KB) per value, `ATMOBB_KV_MAX_STORE_BYTES` (256 KB) for the whole store, `ATMOBB_KV_MAX_WRITES_PER_MINUTE` (60) sets and deletes a minute, not counting writes from `migrate`. The store survives disable, and lives 30 days past uninstall before a purge removes it; reinstalling the same repository in that time, at the same `dataVersion`, gets it back.

**`records`**: create, put, delete, get, and list records in your declared collections, always written to the forum's repo as the forum account.

```ts
records.create({ collection, rkey?, record })
records.put({ collection, rkey, record })
records.delete({ collection, rkey })
records.get({ repo?, collection, rkey })
records.list({ repo?, collection })
```

Writes are capped at `ATMOBB_EXTENSIONS_RECORD_WRITES_PER_HOUR` (100) an hour per install, and the record has to validate against your shipped lexicon. A write fails until the forum account's login covers your collection (see [Reconnecting the forum account](#reconnecting-the-forum-account)). Reads without a `repo` read the forum's own repo, where your writes went. Reads may name any other repo, but only a collection you've declared, and page through up to 10 pages of 100 before coming back `truncated: true`. Records you've published stay in the forum's repo even after you're uninstalled.

**`timers`**: scheduled calls to your `timer` handler.

```ts
timers.set({ name, at, payload? })  // ISO 8601; replaces a pending timer with the same name
timers.cancel(name)
```

`at` has to be at least `ATMOBB_EXTENSIONS_TIMER_MIN_DELAY_MS` (60 s) from now, and an install may have at most `ATMOBB_EXTENSIONS_TIMER_CAP` (200) pending. Names are capped at `ATMOBB_EXTENSIONS_TIMER_MAX_NAME_LENGTH` (200 characters) and payloads at `ATMOBB_EXTENSIONS_TIMER_MAX_PAYLOAD_BYTES` (16 KB) serialized. A poller checks every 30 seconds; delivery is at least once, so a `timer` handler has to tolerate a repeat. A failed dispatch retries with backoff starting at a minute and doubling up to an hour; a timer whose install is disabled waits and fires, late, once it's enabled again; a timer whose install is gone is dropped.

**`notify`**: send to members who turned notifications on.

```ts
notify({ to, title, message, link? })  // up to 50 DIDs; the host prefixes your extension's name to the title
```

`ATMOBB_EXTENSIONS_NOTIFY_PER_RECIPIENT_PER_DAY` (20) and `ATMOBB_EXTENSIONS_NOTIFY_PER_INSTALL_PER_DAY` (100) cap sends; title and message are cut to 100 and 500 characters. A `link` has to be a path on the forum, and the forum has to be running with `ATMOBB_APP_URL` set; without it every link is refused with `invalid_link`, so on a dev forum that doesn't set it, send without one. Recipients who haven't opted in, or aren't in open or member standing, are skipped without saying which.

### Handlers

`src/index.ts` exports `defineExtension({ ... })` from the kit's runtime as its default export. Handlers run synchronously: no `async`, no returned Promises.

- **`action(input)`**, required. `input` is `{ viewer, thread, forum, action, input }`; `thread` is the bound thread the call came from, or `null` on a standalone page. Whatever you return (any JSON) goes back to the panel.
- **`attach(input)`**, optional. Staff attached you to a thread; `input` is `{ viewer, thread, forum, input }`, with `input.input` whatever your attach form collected. Refusing or throwing undoes the attach, and atmoBB removes the binding it already wrote. Without this handler you can never be attached to a thread.
- **`timer({ name, at, payload, forum })`**, optional. A `timers.set` call came due.
- **`openWork()`**, optional, returns a boolean. Whether there's work in progress an admin should know about before disabling or uninstalling you.
- **`migrate({ from, to })`**, optional. Runs once, before an update takes effect, when the new release's `dataVersion` is higher than the version your stored data is at. Throwing keeps the previous release active and puts your k/v store back as it was just before `migrate` started, keeping writes your other handlers made before then; records it already wrote stay written. It may write records only in collections both the old and the new release declare, since the forum's login doesn't cover a collection the update adds until the update is live; write those from the new release's other handlers instead.

`forum.did` is the forum account's DID, the repo every record you write lands in, so you can build at-uris to your own records without writing one first.

To turn down an action or an attach with something the person should read, call `refuse(message, code?)`:

```ts
if (!army) refuse('You have no army in Paris.', 'no_army');
```

A refused action answers the panel with `{ ok: false, error: { code, message } }` (the action endpoint answers 422 with `{ code, message }`), and a refused attach shows staff the message on the attach page. The message is shown as written, so keep anything private out of it; it's cut at 300 characters. `code` defaults to `refused` and must be lowercase letters, digits, and underscores, up to 40. Any other throw is a bug as far as atmoBB is concerned: the person gets a generic "failed" error, and your thrown message goes only to [the extension log](#the-extension-log), never to the page or the server's own logs.

Under the hood, `action` and `attach` output an envelope, `{ value }` or `{ refused: { code, message } }`; the kit writes it for you.

`Math.random` is safe to use inside handlers. The compiler snapshots your module once it has loaded, random state and all, so the kit swaps `Math.random` for one backed by `crypto.getRandomValues` on each instance's first handler call. A `Math.random` call at the top level of your module runs before that snapshot and repeats on every cold start.

### Panels

`ui.entry` is your panel's HTML page, shown in a sandboxed frame: on a thread you're bound to, on your own standalone page at `/ext/<repository host and path>` (optionally with a page inside it after `/-/`, like `/ext/git.example/jack/diplomacy/-/games/spring-1901`), and on the page staff use to attach you. That address follows your repository, not your install, so a link keeps working after a reinstall.

atmoBB draws your extension's name above the frame, where your panel can't reach it, with a chip beside it: **endorsed extension** when the atmobb.app directory reviewed this exact release, and **unverified extension** otherwise, including when the directory endorses your repository but not this release. See [Install review](#install-review) for what endorsement means.

The frame is sandboxed to scripts only: no access to the forum page, its cookies, or its session, no `fetch`, no forms, no popups, no workers, and it loads scripts, styles, images, and fonts only from your own UI directory, plus the forum's fonts stylesheet (see [Matching the forum](#matching-the-forum)). Scripts must be classic (`<script src="panel.js" defer>`), not modules. Kept file types: `.html` (the entry only), `.js`, `.css`, `.svg`, `.png`, `.webp`, `.woff2`, `.json`. A panel that navigates itself away from its page is torn down.

The panel and the page trade `postMessage`s in bridge version 1, every message carrying `v: 1`:

| direction | message |
| --- | --- |
| panel → page | `{ type: 'atmobb:action', v: 1, id, action, input }` runs your `action` handler as the viewer |
| panel → page | `{ type: 'atmobb:resize', v: 1, height }` sizes the frame, clamped to 48 to 2400px |
| panel → page | `{ type: 'atmobb:attach', v: 1, params }` (attach page only) attaches with this setup |
| panel → page | `{ type: 'atmobb:source', v: 1, did }` (standalone page only) names the repo the records you're showing come from |
| panel → page | `{ type: 'atmobb:link', v: 1, page, label }` (thread and page modes only) draws a link to one of your standalone pages, outside the frame |
| panel → page | `{ type: 'atmobb:names', v: 1, id, dids, handles }` (every mode) asks who up to 100 DIDs are and whose up to 20 handles are |
| page → panel | `{ type: 'atmobb:init', v: 1, mode, thread, signedIn, path, pageBase, theme }` once, on load; `mode` is `thread`, `page`, or `attach`, `pageBase` is your standalone page's address, like `/ext/git.example/jack/diplomacy`, and `theme` is how the forum looks |
| page → panel | `{ type: 'atmobb:theme', v: 1, theme }` when the forum's look changes while the panel is open |
| page → panel | `{ type: 'atmobb:result', v: 1, id, ok, value }` or `{ ..., ok: false, error: { code, message } }`, answering an action |
| page → panel | `{ type: 'atmobb:names-result', v: 1, id, names, dids }`, answering a names message |

Post to `parent` with target origin `'*'` (the frame's own origin is opaque) and accept only messages whose `event.source` is `parent`; the template's `ui/panel.js` already does this. Action names top out at 128 characters, message ids at 64, and action input or attach params at 64 KB of JSON; a panel can have at most 8 actions waiting on the server at once.

`pageBase` comes in every mode, so a panel on a thread knows where its standalone page is even though it can't link there itself: the frame's sandbox doesn't let it navigate the forum page, and a link followed inside the frame closes the panel. Send `atmobb:link` instead, and atmoBB draws the link for you, outside the frame, next to your extension's name. `page` is the part of the address after `<pageBase>/-/` — for example `games/spring-1901` to point signed-out readers at a board they can open without signing in — validated strictly (relative, no scheme, no `//`, no `..` segments, no backslashes, and only letters, digits, and `._~:@%+-/`; a leading `/` is refused) and rebuilt into the address itself rather than trusted as a string, so a malformed one is dropped rather than shown broken. `label` is its visible text, trimmed to 1–80 characters; atmoBB renders it as plain text, never as HTML. One link shows at a time: a later `atmobb:link` replaces it, and an empty `page` clears it. The message is ignored on the attach page, where there's no page of your own to point at yet.

On your standalone page, send `atmobb:source` when you show records read from another repo, like a replay of a game some forum published. atmoBB draws a line above your frame, where your panel can't reach or imitate it: "Records from" the account's handle when the handle resolves back to that DID (otherwise just the DID), the full DID either way, and a chip saying "atmoBB forum" when the DID's repo holds an `app.atmobb.forum.profile` record, or "not an atmoBB forum" when it doesn't or couldn't be checked. It shows "Checking source…" while it looks. atmoBB reads the DID document and the forum profile straight from the account's own PDS, not from any forum's index, so the line works for a forum that has shut down as long as its account's repo is still served. One source shows at a time; sending a different DID replaces the line, and sending the same DID again does nothing. The message is ignored on threads and on the attach page, where the records are the forum's own.

The page looks the source up at `GET /x/<install>/source?did=<did>`, which answers `{ did, handle, handleVerified, forum, forumName? }`, plus `unavailable: true` when the DID document or the repo couldn't be read (with `forum: false`). It's limited to 30 lookups a minute per client address and caches answers for five minutes (thirty seconds when unavailable).

Your panel only ever sees people as DIDs, and it can't look anyone up itself: your handlers have no network and the frame's CSP is `connect-src 'none'`. Send `atmobb:names` to show people by name, or to let someone type a handle where you need a DID. `dids` lists up to 100 DIDs and `handles` up to 20 handles, with or without a leading `@`; you may leave either list out, but not both, and a message with a malformed entry or too many is ignored, so it gets no answer. The page answers with `atmobb:names-result` carrying the same `id`:

```js
{
  type: 'atmobb:names-result', v: 1, id,
  names: { 'did:plc:…': { handle: 'keith.is', displayName: 'Keith' }, 'did:plc:…': null },
  dids: { '@keith.is': 'did:plc:…', 'nobody.example': null },
}
```

`names` has an entry for each DID you asked about and `dids` one for each handle, keyed exactly as you sent it. A handle only counts when it resolves back to the same DID, the check a source line makes; otherwise the entry is null, and so is one for an account that couldn't be read in time. Show the DID when a name is null. `displayName` is the member's display name as this forum shows it, when they've set one. The answer is display help, not proof: your handlers still get only the viewer's DID, so check any DID a form submits on the server side as you would anyway.

The page asks `GET /x/<install>/names?did=<did>&did=…&handle=<handle>&…` for these. It's limited to 30 requests a minute per install per client address, answers within about eight seconds with null for any lookup still running, and caches names for five minutes (thirty seconds for a null). Ask once per DID per page load, not on every render.

On a thread, only signed-in members can run actions. On your standalone page, signed-out visitors can too, counted per client address (see [self-hosting](self-hosting.md#configuration-and-secrets) for `ADDRESS_HEADER`/`XFF_DEPTH`, which that count depends on behind a proxy). Signed-in actions are capped at `ATMOBB_EXTENSIONS_ACTIONS_PER_VIEWER_PER_MINUTE` (30) per viewer per install and `ATMOBB_EXTENSIONS_ACTIONS_PER_INSTALL_PER_MINUTE` (300) per install; signed-out actions get the same 30 a minute per client address per install, share `ATMOBB_EXTENSIONS_ANONYMOUS_ACTIONS_PER_INSTALL_PER_MINUTE` (60) across every address, and run one at a time per install.

#### Matching the forum

`theme` tells your panel how the page around it looks, so it can match instead of following the viewer's system scheme. Apply init's `theme` and every `atmobb:theme` with the same function:

```js
{
  scheme: 'light',
  colors: { ground: '#eceae7', surface: '#ffffff', ink: '#2b2a2e', accent: '#f79b7a', /* … */ },
  fonts: { body: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif", /* … */ },
}
```

`scheme` is `light` or `dark`, whichever the forum page is showing: atmoBB judges it by the page's background color, falling back to the page's `color-scheme`. Set your document's `color-scheme` to it, rather than `light dark`, so native controls and any `light-dark()` in your CSS follow the forum and not the viewer's system.

`colors` are CSS colors, read from the forum's own theme tokens (see [theming](theming.md)), so they follow a built-in theme, owner CSS, and a member's personal theme alike:

| name | what it's for | forum token |
| --- | --- | --- |
| `ground` | the page background | `--forum-bg` |
| `surface` | cards and panels; the page draws it behind your frame | `--forum-surface` |
| `surfaceAlt` | alternate stripes and sunken rows | `--forum-surface-2` |
| `sunken` | deeper wells | `--forum-sunken` |
| `line`, `lineStrong` | hairlines, and stronger dividers and edges | `--forum-line`, `--forum-line-strong` |
| `ink`, `inkSoft`, `inkFaint` | text, secondary text, and tertiary or disabled text | `--forum-ink`, `--forum-ink-soft`, `--forum-ink-faint` |
| `accent`, `accentHover` | accent fills, such as buttons, and their hover | `--forum-accent`, `--forum-accent-hover` |
| `accentInk` | text on an accent fill | `--forum-accent-ink` |
| `accentSoft` | a soft accent tint | `--forum-accent-soft` |
| `link`, `linkHover` | link text and its hover | `--forum-link`, `--forum-link-hover` |
| `ok`, `warn`, `danger` | status text | `--ok-1`, `--warn-1`, `--danger-1` |
| `okSoft`, `warnSoft`, `dangerSoft` | status backgrounds | `--ok-bg`, `--warn-bg`, `--danger-bg` |

`fonts` has `body`, `display`, and `mono`, each a font-family list, from `--font-body`, `--font-display`, and `--font-mono`.

Any name can be missing. atmoBB sends a color only when the browser parses it as one and it's written in a plain character set with no `url()`, `var()`, `env()`, `attr()`, or `image()`, and a font list only when it's made of quoted family names (letters, digits, spaces, `._-`) and generic families like `sans-serif` or `ui-monospace`. A theme token owner CSS sets to anything else, like an unquoted `Georgia`, is left out, so keep a fallback for every value you use. Set the values with the CSSOM, like `document.documentElement.style.setProperty('--forum-ink', theme.colors.ink)`; the frame's CSP allows that, but not a `style` attribute or a `<style>` element. The template's `ui/panel.js` does this, as `--forum-*` custom properties, and `ui/panel.css` uses them.

Themes are chosen on the server, so `atmobb:theme` comes only when the page's look changes in place: when owner CSS follows the viewer's system scheme and the viewer's system switches. atmoBB sends one only when the theme actually changed.

The forum's default faces, IBM Plex Sans and IBM Plex Mono, are served to frames from the forum itself at `/x/fonts/fonts.css`, in the weights the forum uses (Sans 400 to 700 plus italic 400 and 500, Mono 400 to 600). Link it from your entry, before your own stylesheet:

```html
<link rel="stylesheet" href="/x/fonts/fonts.css" />
```

The frame's CSP allows exactly that stylesheet in `style-src` and the font files beside it, `/x/fonts/`, in `font-src`, on top of your UI directory; no other stylesheet or font outside your UI directory loads. The forum page gets these faces from Google Fonts, but the frame never contacts a third party. Fonts an owner uploads live on the forum account's PDS, which the frame can't reach, so a font list naming one falls through to its next family. `/x/fonts/fonts.css` answers only a stylesheet load and its files only a font load, each with `Cross-Origin-Resource-Policy: cross-origin` and `Access-Control-Allow-Origin: *`, since your frame's origin is opaque and fonts load in CORS mode.

### What an extension can see

`action` and `attach` are told the viewer's DID (or `null` signed out), their standing on this forum, whether they're staff, and whether they're banned, plus the forum account's DID. Never a session, a cookie, or credentials of any kind. On a bound thread, `thread.uri` is the at-uri of the thread it's running in. Extensions only ever attach to threads on public boards, because everything they publish is public too.

### The extension log

`console.log`, `warn`, and the rest, plus your handlers' thrown errors (but not refusals), go to a small per-install log: the last 200 lines, each cut to 500 characters, readable by this forum's admins on the install's page. It lives in the forum process's memory, so it's empty again after a restart or a deploy. Nothing you don't log reaches it, and nothing in it reaches anywhere else. Don't log anything private; the log isn't access-controlled beyond "admins of this forum."

### Shipping a release

atmoBB installs a git tag whose tree holds a built `dist/`. Build for real (`npm run build`), commit `dist/`, tag the commit, and push:

```sh
npm run build
git add dist && git commit -m "Release 0.1.0"
git tag v0.1.0
git push && git push --tags
```

Tag names are read as semantic versions, with or without a leading `v`. When an admin leaves the tag blank, atmoBB installs the newest tag that isn't a prerelease; on an installed extension it offers only version tags newer than the running one as updates. A tag it can't read as a version can only be installed by typing its name.

An admin installs from your repository's `https://` URL (the only scheme accepted), and your standalone page's address follows from it: `https://git.example/jack/diplomacy` is served at `/ext/git.example/jack/diplomacy` on every forum that installs it. The kit isn't on npm yet, so until it is, tell people who want to build on your work to clone atmoBB.

Every install of your extension that declares collections needs its admin to reconnect the forum account before the first write works, so say so in your own README.

## Installing and running extensions

> [!WARNING]
> Extensions are experimental. The platform is new, the host API can still change under an installed extension, and installing one lets code you didn't write publish records as the forum account, in collections of its own. Install only what you'd vouch for, keep [backups](self-hosting.md#backups) current, and report anything that goes wrong on the [Bugs board](https://atmobb.app/b/3mqdahz5y4m2f) on atmobb.app.

**Admin → Extensions** installs, updates, and manages extensions. It needs `ATMOBB_EXTENSIONS` unset (or anything but `off`) and this process holding the extensions lock (see [self-hosting](self-hosting.md#extensions)); otherwise the page says so and refuses changes.

### Install review

Enter a repository's `https://` URL and, optionally, a tag; atmoBB fetches the tag (or the latest release tag if you leave it blank), admits the manifest, and shows the admin:

- the records it would publish, all under one NSID authority, and whether that authority's published lexicons match what's shipped: **Verified** (they match), **Unpublished** (nothing to check against), or refused outright if they differ;
- one of three trust marks: **Unverified extension** (the atmobb.app directory hasn't endorsed this repository; you can still install it, but only if you trust who publishes it), **Endorsed repository** (the directory endorses the repository but hasn't reviewed this exact release), or **Trusted** (the directory endorses the repository and reviewed this exact release);
- what it can do, from its declared capabilities;
- what it can see: the account (DID) of every signed-in member who opens a thread it's attached to, and whether they're a member, staff, or banned here;
- when the same repository was uninstalled here within the last 30 days and this release has the same `dataVersion` as the one uninstalled, that the data it saved comes back.

Confirming claims the collections, moves the bundle into place, and installs it active. A review you don't confirm is discarded after an hour; start it again from the repository URL. An update shows the same review plus a diff against the manifest currently running: added or removed collections and capabilities, a host API bump, and whether stored data needs a `migrate`.

### Reconnecting the forum account

Installing or updating an extension that declares new collections widens the OAuth scope the forum account's login needs. **Admin → Extensions** then lists the collections the login is missing and links to **Admin → Connection**; reconnect from there. Until you do, the extension's record writes fail. The forum account's PDS can cache the old permission set for about 10 minutes, so if the consent screen doesn't list the new collections yet, wait a few minutes and reconnect again.

### Updates, rollback, and migrate

**Admin → Extensions → an install** lists version tags newer than the one running, and any tag already run whose commit has since changed underneath it. Staging and applying an update works like install: review, then confirm. If the new release's `dataVersion` is higher, its `migrate` handler runs against the install's stored data before it switches over. `migrate` waits its turn behind calls the running release already has queued, and the install's k/v store is snapshotted when that turn starts, so their writes are kept. If `migrate` throws or goes past its limits, or the update gives up waiting on it after 60 seconds, the previous release stays active. From then on the migration's k/v, record, and timer writes are refused, and the k/v store is put back as the snapshot found it before any other call to the install runs. A migration the update gave up on before its turn came never runs. Records it already wrote to the forum's repo, and timers it already set, aren't undone. A migration's k/v writes don't count against the per-minute write rate, and it may only write records in collections both releases declare.

Rollback switches an install back to a release it has run before, as long as that release's bundle is still on disk and its recorded `dataVersion` still matches what's currently active. A successful `migrate` forecloses rolling back past it, since the data it converted is no longer at the old version.

### Disabling and uninstalling

Disable stops an install from running; enable turns it back on. Disabling and uninstalling first ask the install's `openWork` handler, if it has one, whether there's work in progress; if it says yes, atmoBB refuses and the page offers to **force** it through instead. Uninstalling also removes the install's bundles; its k/v store and pending timers survive for 30 days, then a daily purge removes them. Reinstalling the same repository inside those 30 days, with a release at the same `dataVersion` as the one uninstalled, picks the install back up under its old id, with its k/v store and any timers that haven't come due yet (a timer that came due while it was uninstalled was dropped). The install review says so. A release at any other `dataVersion` installs fresh under a new id, since nothing converts the earlier data on a reinstall; the earlier data waits out its 30 days and is purged. Records it already published, and its collection claims, are never touched by uninstalling.

### Claims

The first repository to declare a collection owns it permanently, across reinstalls, so a different repository can never quietly take over records already sitting in the forum's repo. Uninstalling an extension doesn't release its claims. **Admin → Extensions** lists claims with no installed extension behind them and lets an admin release one by hand, after confirming, but only when no installed extension still declares it.

### Attaching to a thread

Staff who moderate the whole forum can attach an extension to a thread from the thread page, if the extension exports `attach` and the thread sits on a public board. Members-only boards are out, since everything an extension publishes is public. atmoBB writes the binding record itself, an `app.atmobb.extension.binding` in the forum's own repo, a collection extensions can never write to themselves, then calls the extension's `attach` handler with the setup its form collected. A refusal or failure there removes the binding again, and the attach page shows staff the extension's refusal message. One extension per thread; a thread already bound refuses another attach.

Attaching is one-way for now. There's no detach in the forum: the binding record stays in the forum's repo, so the thread keeps that extension, and after the extension is uninstalled the thread takes no other one until the record is removed by hand from the forum account's repo. Reinstalling the same repository picks the thread's binding back up.

### The kill switch

Set `ATMOBB_EXTENSIONS=off` to turn every extension off, forum-wide: no calls, no panels, no timers, nothing added to the login scope, and **Admin → Extensions** refuses changes. Anything else, including leaving it unset, is on.

## Reporting problems

Post on the [Bugs board](https://atmobb.app/b/3mqdahz5y4m2f) on atmobb.app. If you'd rather not sign in there, [GitHub issues](https://github.com/keithk/atmoBB/issues) works too. For a problem with an extension you're writing, include the atmoBB version or commit, the kit's `compiler-version.json`, your `manifest.json`, the lines from the extension log on the install's page, and what you expected instead. For a problem installing or running one, include the review page's refusal text and the extension's repository URL and tag. Questions about what the platform should do next go in the same place. The first real extensions will decide what changes.
