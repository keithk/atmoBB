import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './build';
import { BuildError } from './build-error';

// The dev loop: build, then rebuild whenever the project changes. A forum
// running with ATMOBB_EXTENSIONS_DEV=1 can install the project straight from
// its directory, reading dist/ as a release, so each rebuild is one update
// away from running there.

/** Changes under these top-level directories don't trigger a rebuild. */
const IGNORED = new Set(['dist', 'node_modules', '.git']);
const SETTLE_MS = 200;

const stamp = () => new Date().toLocaleTimeString();

async function buildOnce(projectDir: string): Promise<boolean> {
  const started = performance.now();
  try {
    const result = await build({ projectDir });
    console.log(`[${stamp()}] Built ${result.manifest.name} ${result.manifest.version} in ${Math.round(performance.now() - started)}ms (handlers: ${result.exports.join(', ')})`);
    return true;
  } catch (error) {
    console.error(`[${stamp()}] Build failed:\n${error instanceof BuildError ? error.message : error instanceof Error ? error.stack : String(error)}`);
    return false;
  }
}

export async function dev(projectArg: string, forumUrl: string): Promise<void> {
  const projectDir = resolve(projectArg);
  await buildOnce(projectDir);

  const admin = new URL('/admin/extensions', forumUrl).href;
  console.log(`
To run it on your dev forum:
  1. Start atmoBB with ATMOBB_EXTENSIONS_DEV=1 (local file:// installs are refused without it).
  2. Install once from ${admin} with this URL:
       ${pathToFileURL(projectDir).href}
  3. After a rebuild, open the install's page there, re-read the local project, and confirm the update.
     Console output and errors from your handlers show in the extension log on that page.

Watching ${projectDir} for changes. Ctrl+C stops.`);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<boolean> | null = null;
  let again = false;

  const rebuild = async () => {
    if (running) {
      again = true;
      return;
    }
    running = buildOnce(projectDir);
    await running;
    running = null;
    if (again) {
      again = false;
      await rebuild();
    }
  };

  watch(projectDir, { recursive: true }, (_event, filename) => {
    const top = filename?.toString().split(/[\\/]/)[0];
    if (top && IGNORED.has(top)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), SETTLE_MS);
  });
  await new Promise(() => {});
}
