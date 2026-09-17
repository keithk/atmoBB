// Bundles the CLI into lib/cli/index.mjs. The CLI checks manifests with
// atmoBB's own admission rules, so it pulls src/lib/server/extensions/manifest.ts
// from the repo; the aliases stand in for the SvelteKit modules that file uses.
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const kit = fileURLToPath(new URL('..', import.meta.url));

const { metafile } = await build({
  absWorkingDir: kit,
  entryPoints: ['src/cli/index.ts'],
  outfile: 'lib/cli/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // esbuild runs from the kit's own install at build time.
  external: ['esbuild'],
  alias: {
    $lib: '../../../src/lib',
    '$env/dynamic/private': './src/cli/sveltekit-env.ts',
  },
  // The repo root's packages when they're installed, the kit's otherwise.
  nodePaths: [`${kit}node_modules`],
  // Bundled CommonJS dependencies call require() for Node built-ins.
  banner: { js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);" },
  logLevel: 'warning',
  // bin/atmobb-extension.mjs compares these inputs against the bundle to tell when it's out of date.
  metafile: true,
});

await writeFile(new URL('../lib/cli/meta.json', import.meta.url), JSON.stringify({ inputs: Object.fromEntries(Object.keys(metafile.inputs).map((input) => [input, {}])) }));
