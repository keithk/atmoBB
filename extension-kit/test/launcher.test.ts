import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The launcher runs a fake kit laid out like the real one: a bundle that says
// which build it is, esbuild's metafile naming its one input, and a build
// script that writes a new bundle.

let kit: string;

const run = async () => (await promisify(execFile)(process.execPath, [join(kit, 'bin', 'atmobb-extension.mjs'), 'build'])).stdout.trim();

async function age(path: string, secondsAgo: number) {
  const at = new Date(Date.now() - secondsAgo * 1000);
  await utimes(join(kit, path), at, at);
}

beforeEach(async () => {
  kit = await mkdtemp(join(tmpdir(), 'kit-launcher-'));
  await mkdir(join(kit, 'bin'));
  await cp(new URL('../bin/atmobb-extension.mjs', import.meta.url), join(kit, 'bin', 'atmobb-extension.mjs'));
  await mkdir(join(kit, 'lib', 'cli'), { recursive: true });
  await mkdir(join(kit, 'src', 'cli'), { recursive: true });
  await mkdir(join(kit, 'scripts'));
  await writeFile(join(kit, 'src', 'cli', 'index.ts'), '');
  await writeFile(join(kit, 'lib', 'cli', 'index.mjs'), "console.log('old bundle', process.argv.slice(2).join(' '));\n");
  await writeFile(join(kit, 'lib', 'cli', 'meta.json'), JSON.stringify({ inputs: { 'src/cli/index.ts': {} } }));
  await writeFile(
    join(kit, 'scripts', 'build-cli.mjs'),
    [
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "await mkdir(new URL('../lib/cli/', import.meta.url), { recursive: true });",
      "await writeFile(new URL('../lib/cli/index.mjs', import.meta.url), \"console.log('new bundle', process.argv.slice(2).join(' '));\");",
    ].join('\n'),
  );
});

afterEach(async () => {
  await rm(kit, { recursive: true, force: true });
});

describe('the atmobb-extension launcher', () => {
  it('runs the built CLI as it is when no source changed since the build', async () => {
    await age('src/cli/index.ts', 60);
    expect(await run()).toBe('old bundle build');
  });

  it('rebuilds the CLI first when a source file is newer than the bundle', async () => {
    await age('lib/cli/index.mjs', 60);
    expect(await run()).toBe('new bundle build');
  });

  it('builds the CLI when it was never built', async () => {
    await rm(join(kit, 'lib'), { recursive: true });
    expect(await run()).toBe('new bundle build');
  });

  it('runs the bundle without checking when the kit has no build script', async () => {
    await age('lib/cli/index.mjs', 60);
    await rm(join(kit, 'scripts'), { recursive: true });
    expect(await run()).toBe('old bundle build');
  });
});
