#!/usr/bin/env node
// The package's bin. The CLI itself is bundled into lib/cli/index.mjs, which
// isn't committed: installing the kit builds it. In a checkout of the kit,
// where scripts/build-cli.mjs is present, the bundle is rebuilt first whenever
// any file it was bundled from (listed in the build's esbuild metafile) has
// changed since, so edits to the kit or to atmoBB's shared code take effect on
// the next run instead of being silently ignored.
import { access, readFile, stat } from 'node:fs/promises';

const kit = new URL('../', import.meta.url);
const bundle = new URL('lib/cli/index.mjs', kit);
const buildScript = new URL('scripts/build-cli.mjs', kit);

const modified = (url) => stat(url).then(({ mtimeMs }) => mtimeMs, () => null);

async function bundleIsStale() {
  const built = await modified(bundle);
  if (built === null) return true;
  let inputs;
  try {
    inputs = Object.keys(JSON.parse(await readFile(new URL('lib/cli/meta.json', kit), 'utf8')).inputs);
  } catch {
    return true;
  }
  for (const input of inputs) {
    // A missing input counts as changed, so the rebuild reports what's wrong.
    const changed = (await modified(new URL(input, kit))) ?? Infinity;
    if (changed > built) return true;
  }
  return false;
}

const inCheckout = await access(buildScript).then(() => true, () => false);
if (inCheckout && (await bundleIsStale())) {
  console.error('atmobb-extension: the CLI source changed since it was built; rebuilding it first.');
  await import(buildScript.href);
}
await import(bundle.href);
