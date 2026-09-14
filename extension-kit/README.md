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
node lib/cli/index.mjs new ~/code/my-counter
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
import { defineExtension, kv, records, timers, notify, HostCallError } from 'atmobb-extension-kit';

export default defineExtension({
  action({ viewer, thread, action, input }) {
    const key = `count:${thread?.uri}`;
    const count = (kv.get<number>(key) ?? 0) + 1;
    kv.set(key, count);
    return { count }; // any JSON goes back to the panel
  },
  attach({ viewer, thread, input }) {}, // optional: staff attached the extension to a thread
  timer({ name, payload }) {},  // optional: a timer from timers.set came due
  openWork() { return false; }, // optional: work in progress an admin should see before disabling
  migrate({ from, to }) {},     // optional: runs when a new release raises dataVersion
});
```

- Staff attach an extension to a thread on a public board. atmoBB records the
  binding itself, then calls `attach` with the setup the extension's attach
  form collected; throwing refuses the attach and atmoBB removes the binding.
  An extension without `attach` can't be attached to threads. `action` gets
  the thread it runs in as `thread`, or null outside a thread.
- `kv.get/set/delete/list` read and write the install's private store.
- `records.create/put/delete/list/get` work with records in your declared collections.
- `timers.set/cancel` schedule calls to your `timer` handler.
- `notify` sends notifications to members who turned them on.

Each function needs its capability in the manifest (`kv`, `records`,
`timers`, `notify`). When the host refuses a call, the function throws a
`HostCallError` with a stable `code`, like `capability_not_granted` or
`rate_limited`. Handlers run synchronously. `console.log` output goes to the
extension log on the install's admin page.

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
| page → panel | `{ type: 'atmobb:init', v: 1, mode, thread, signedIn, path }` once the panel loads; `mode` is `thread`, `page`, or `attach` |
| page → panel | `{ type: 'atmobb:result', v: 1, id, ok, value }` or `{ ..., ok: false, error: { code, message } }` answers an action |

Post to `parent` with target origin `'*'` (the frame has no origin of its own)
and accept only messages whose `event.source` is `parent`. The template's
`ui/panel.js` does all of this.

On a thread, only signed-in members can run actions. On the extension's own
page, at `/ext/<repository host and path>` (for example
`/ext/git.example/jack/diplomacy`, with a page inside it after `/-/`, like
`/ext/git.example/jack/diplomacy/-/games/spring-1901`), signed-out visitors can
run actions too, and `path` tells the panel which page it's on. That address
follows the repository, so links keep working after a reinstall.

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

