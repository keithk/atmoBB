# atmoBB extension kit

Write an atmoBB extension in TypeScript and build it into a release a forum
can install. You don't touch WebAssembly: the kit bundles your code, compiles
it with the pinned Extism JS compiler, checks your manifest against the rules
atmoBB applies at install, and writes `dist/`.

Needs Node 22.19 or newer on macOS (arm64, x64) or Linux (x64, arm64).

## Start an extension

The kit isn't on npm yet, so use it from this repository:

```sh
cd extension-kit
bun install                     # or npm install; also builds the CLI into lib/
node bin/atmobb-extension.mjs new ~/code/my-counter
cd ~/code/my-counter
npm install
npm run build
```

`new` copies the starter template, a counter that uses each part of the host
API an extension usually needs:

| File | What it is |
| --- | --- |
| `manifest.json` | Name, version, host API, declared collections, capabilities, UI entry, lexicon files |
| `src/index.ts` | The extension: `export default defineExtension({ attach, action, timer })` |
| `lexicons/com.example.counter.tally.json` | The record lexicon for the declared collection |
| `ui/` | The panel: `index.html`, a script, and a stylesheet |

Change `com.example.counter` to an NSID authority you control (a domain you
own, reversed) in the manifest, the lexicon, and `src/index.ts`.

## The author API

```ts
import { defineExtension, kv, records, timers, notify, refuse, HostCallError } from 'atmobb-extension-kit';

export default defineExtension({
  action({ viewer, thread, forum, action, input }) {
    if (!thread) refuse('The counter only runs in a thread.', 'not_in_thread');
    const key = `count:${thread.uri}`;
    const count = (kv.get<number>(key) ?? 0) + 1;
    kv.set(key, count);
    return { count }; // any JSON goes back to the panel
  },
  attach({ viewer, thread, forum, input }) {}, // optional: staff attached the extension to a thread
  timer({ name, at, payload, forum }) {},  // optional: a timer from timers.set came due
  openWork() { return false; }, // optional: work in progress an admin should see before disabling
  migrate({ from, to }) {},     // optional: runs when a new release raises dataVersion
});
```

- Staff attach an extension to a thread on a public board. atmoBB records the
  binding itself, then calls `attach` with the setup the extension's attach
  form collected; refusing or throwing undoes the attach and atmoBB removes the
  binding. An extension without `attach` can't be attached to threads.
  `action` gets the thread it runs in as `thread`, or null outside a thread.
- `action`, `attach`, and `timer` get `forum.did`, the forum account's DID:
  the repo your records are written to, for building at-uris to them.
- `refuse(message, code?)` turns an action or attach down with a message for
  the person who asked, like `refuse('You have no army in Paris.', 'no_army')`.
  The panel gets it as `{ ok: false, error: { code, message } }`, and the
  attach page shows it to staff. The message is cut at 300 characters; `code`
  (default `refused`) is lowercase letters, digits, and underscores, up to 40.
  Any other throw is treated as a bug: the person sees a generic error, and
  the thrown message goes only to the extension log.
- `kv.get/set/delete/list` read and write the install's private store.
- `records.create/put/delete/list/get` work with records in your declared
  collections. Writes always go to the forum's repo; `list` and `get` read it
  too unless you name another `repo`.
- `timers.set/cancel` schedule calls to your `timer` handler.
- `notify` sends notifications to members who turned them on.

Each function needs its capability in the manifest (`kv`, `records`,
`timers`, `notify`). When the host refuses a call, the function throws a
`HostCallError` with a stable `code`, like `capability_not_granted` or
`rate_limited`. Handlers run synchronously. `console.log` output goes to the
extension log on the install's admin page.

`Math.random` works as usual. The compiler snapshots your module after it
loads, so the kit replaces `Math.random` with one backed by
`crypto.getRandomValues` on each instance's first handler call; without that,
every cold start would repeat the same sequence. Don't call `Math.random` at
the top level of your module, where it still runs before the snapshot.

## The panel

`ui.entry` is the panel's HTML page. atmoBB shows it in a frame on threads the
extension is attached to, on the extension's own page, and on the page where
staff attach it to a thread. The frame is sandboxed to scripts only: the panel
can't read the forum page, its cookies, or the session, can't fetch anything,
submit forms, open windows, or start workers, and can load scripts, styles,
images, and fonts only from its own UI directory. Scripts must be classic
scripts (`<script src="panel.js" defer>`), not modules. The files beside the
entry can be `.js`, `.css`, `.svg`, `.png`, `.webp`, `.woff2`, or `.json`;
anything else isn't served. A panel that navigates away from its page is
closed.

The panel talks to atmoBB over `postMessage` with the parent page, in bridge
version 1. Every message carries `v: 1`, and the page ignores any message that
isn't exactly one of these:

| Direction | Message |
| --- | --- |
| panel → page | `{ type: 'atmobb:action', v: 1, id, action, input }` runs your `action` handler as the viewing member; `id` is a number or a short string |
| panel → page | `{ type: 'atmobb:resize', v: 1, height }` sizes the frame, within limits |
| panel → page | `{ type: 'atmobb:attach', v: 1, params }` attaches the extension with this setup (attach page only) |
| panel → page | `{ type: 'atmobb:source', v: 1, did }` names the repo the records you're showing come from (standalone page only) |
| panel → page | `{ type: 'atmobb:link', v: 1, page, label }` draws a link to one of your standalone pages, outside the frame (thread and page modes only) |
| panel → page | `{ type: 'atmobb:names', v: 1, id, dids, handles }` asks who up to 100 DIDs are and whose up to 20 handles are (every mode) |
| page → panel | `{ type: 'atmobb:init', v: 1, mode, thread, signedIn, path, pageBase }` once the panel loads; `mode` is `thread`, `page`, or `attach`; `pageBase` is your standalone page's address |
| page → panel | `{ type: 'atmobb:result', v: 1, id, ok, value }` or `{ ..., ok: false, error: { code, message } }` answers an action |
| page → panel | `{ type: 'atmobb:names-result', v: 1, id, names, dids }` answers a names message: `names` maps each DID to `{ handle, displayName? }` or null, `dids` maps each handle, as sent, to its DID or null |

Post to `parent` with target origin `'*'` (the frame has no origin of its own)
and accept only messages whose `event.source` is `parent`. The template's
`ui/panel.js` does all of this.

On a thread, only signed-in members can run actions. On the extension's own
page, at `/ext/<repository host and path>` (for example
`/ext/git.example/jack/diplomacy`, with a page inside it after `/-/`, like
`/ext/git.example/jack/diplomacy/-/games/spring-1901`), signed-out visitors can
run actions too, and `path` tells the panel which page it's on. That address
follows the repository, so links keep working after a reinstall. Every mode's
`init` carries it as `pageBase` (like `/ext/git.example/jack/diplomacy`), so a
panel on a thread knows where your standalone page is, but the sandbox doesn't
let it navigate the forum page — following a link inside the frame closes the
panel. Send `atmobb:link` instead, with `page` (the part of the address after
`<pageBase>/-/`, like `games/spring-1901`) and `label` (its visible text, 1-80
characters). atmoBB validates `page` strictly and rebuilds the address itself
rather than trusting the string, then draws the link outside your frame, next
to your extension's name — this is how a panel on a thread points signed-out
readers at a page they can open without signing in. One link shows at a time;
a later `atmobb:link` replaces it, and an empty `page` clears it. Ignored on
the attach page.

When your standalone page shows records from another repo, such as a replay of
a game a forum published, send `atmobb:source` with that repo's DID. atmoBB
checks the DID itself and draws a line above your frame: "Records from" the
account's verified handle (or the DID when the handle doesn't resolve back to
it), the full DID, and "atmoBB forum" or "not an atmoBB forum" depending on
whether the repo holds an `app.atmobb.forum.profile` record. Your panel can't
change or cover that line. A later `atmobb:source` with a different DID
replaces it. On threads and the attach page the message is ignored.

## Build

`npm run build` (`atmobb-extension build`) writes `dist/`:
`manifest.json`, `extension.wasm`, your lexicon files, and the files beside
`ui.entry`. A build fails before compiling if atmoBB would refuse the manifest,
for example a collection outside your own NSID authority.

The first build downloads `extism-js` and binaryen, the versions and checksums
in `compiler-version.json`, into `~/.cache/atmobb-extension-kit` (set
`ATMOBB_EXTENSION_KIT_CACHE` to use another directory).

## Run it on a dev forum

```sh
npm run dev            # atmobb-extension dev [--forum http://127.0.0.1:5173]
```

`dev` builds, then rebuilds whenever the project changes. On the forum:

1. Start atmoBB with `ATMOBB_EXTENSIONS_DEV=1`. Without it, local installs are refused.
2. Install once from `/admin/extensions` with your project's `file://` URL, which `dev` prints.
3. After each rebuild, open the install's page, re-read the local project, and confirm the update.

## Release

atmoBB installs a git tag whose tree has a built `dist/`. Build, commit `dist/`,
tag the commit (like `v0.1.0`), and push. Admins install from the repository URL.

## Working on the kit

The tests load atmoBB's own runtime, release reader, and manifest admission
rules from `src/lib`, so set up the repository root first
(`bun install && bunx svelte-kit sync` there). Then, in `extension-kit/`:

```sh
bun install
bun run test     # builds test extensions with the real compiler and runs them in atmoBB's runtime
bun run check
```

The `atmobb-extension` command (`bin/atmobb-extension.mjs`) runs the CLI
bundled into `lib/cli/`. In a checkout it first compares the bundle against
every file it was built from, the kit's `src/cli` and the atmoBB code it
shares, and rebuilds it when any has changed, so you never run a stale CLI.
A `dev` loop that's already running keeps the CLI it started with; restart it
after changing the kit. The extension runtime (`src/runtime.ts`) isn't part of
the CLI bundle: every build reads it fresh.

