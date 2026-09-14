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
| `manifest.json` | Name, version, host API, declared collections, the thread binding, capabilities, UI entry, lexicon files |
| `src/index.ts` | The extension: `export default defineExtension({ action, timer })` |
| `lexicons/com.example.counter.tally.json` | The record lexicon for the declared collection |
| `ui/` | The panel: `index.html`, a script, and a stylesheet |

Change `com.example.counter` to an NSID authority you control (a domain you
own, reversed) in the manifest, the lexicon, and `src/index.ts`.

## The author API

```ts
import { defineExtension, kv, records, timers, notify, HostCallError } from 'atmobb-extension-kit';

export default defineExtension({
  action({ viewer, action, input }) {
    const count = (kv.get<number>('count') ?? 0) + 1;
    kv.set('count', count);
    return { count }; // any JSON goes back to the panel
  },
  timer({ name, payload }) {},  // optional: a timer from timers.set came due
  openWork() { return false; }, // optional: work in progress an admin should see before disabling
  migrate({ from, to }) {},     // optional: runs when a new release raises dataVersion
});
```

- `kv.get/set/delete/list` read and write the install's private store.
- `records.create/put/delete/list/get` work with records in your declared collections.
- `timers.set/cancel` schedule calls to your `timer` handler.
- `notify` sends notifications to members who turned them on.

Each function needs its capability in the manifest (`kv`, `records`,
`timers`, `notify`). When the host refuses a call, the function throws a
`HostCallError` with a stable `code`, like `capability_not_granted` or
`rate_limited`. Handlers run synchronously. `console.log` output goes to the
extension log on the install's admin page.

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

