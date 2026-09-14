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

## Toolchain

| Tool | Version | Source |
| --- | --- | --- |
| `extism-js` | release `v1.7.0` (the binary reports `extism-js 1.6.1`) | https://github.com/extism/js-pdk/releases/tag/v1.7.0 |
| binaryen (`wasm-merge`, `wasm-opt`) | `version_132` | https://github.com/WebAssembly/binaryen/releases/tag/version_132 |
| `@extism/extism` (host SDK) | `2.0.0-rc13`, pinned in package.json | npm |

`extism-js` needs `wasm-merge` and `wasm-opt` on `PATH`.

## Rebuild

```sh
PATH="/path/to/extism-js-dir:/path/to/binaryen-version_132/bin:$PATH" \
  extism-js probe.js -i probe.interface.txt -o probe.wasm
```

Builds are not byte-for-byte reproducible: two runs over the same source differ
in a few bytes, so a rebuilt `probe.wasm` shows up as a changed file even when
nothing meaningful changed.
