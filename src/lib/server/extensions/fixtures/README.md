# Extension runtime fixtures

`probe.wasm` is the prebuilt Extism plug-in that `runtime.test.ts` drives. It is
built from `probe.js`, with its Wasm interface (exports plus the
`extism:host/user` imports `wait`, `load`, `save`) declared in
`probe.interface.txt`. The interface file is TypeScript declaration syntax, but
it keeps a `.txt` name so the app's `tsc` program doesn't pick up its
`declare module 'main'` and `I32`/`I64` types.

One module carries every behavior under test (echo, infinite loop, busy loop,
memory hog, async host wait, host-side counter, HTTP request) because each
QuickJS build is about 2.5 MB.

`host-probe.wasm` is the extension `host.test.ts` drives through the real host
ABI. It is built from `host-probe.js`, with `host-probe.interface.txt`
declaring the handler exports (`action`, `attach`, `timer`, `openWork`, `migrate`) and
every `extism:host/user` host function. Its `action` handler switches on the
action name to exercise the host (set a key, publish a record, and schedule a
timer; call any host function repeatedly; produce large output; log and throw).
Its `attach` handler records the setup it was given and echoes the viewer and
thread, or throws when the setup asks it to fail.
The tests that need a module without the optional handlers use a 53-byte
exports-only module inlined in `host.test.ts` instead of a third QuickJS build.

## Toolchain

| Tool | Pinned in |
| --- | --- |
| `extism-js` (Extism JS PDK compiler) | `extension-kit/compiler-version.json`, shared with the extension kit's builds |
| binaryen (`wasm-merge`, `wasm-opt`) | `extension-kit/compiler-version.json` |
| `@extism/extism` (host SDK) | package.json |

`extism-js` needs `wasm-merge` and `wasm-opt` on `PATH`.

## Rebuild

These fixtures call the host ABI directly (`host.test.ts` checks the raw
`{ ok, value | error }` replies, and `probe.js` imports test-only host
functions), so they're compiled with `extism-js` itself rather than through the
kit's `build`. The kit's `toolchain` command downloads the pinned tools and
prints the `PATH` line for them. From this directory, after `bun install` in
`extension-kit/`:

```sh
eval "$(node ../../../../../extension-kit/lib/cli/index.mjs toolchain)"
extism-js probe.js -i probe.interface.txt -o probe.wasm
extism-js host-probe.js -i host-probe.interface.txt -o host-probe.wasm
```

Builds are not byte-for-byte reproducible: two runs over the same source differ
in a few bytes, so a rebuilt module shows up as a changed file even when
nothing meaningful changed.
