import { cp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { BuildError } from './build-error';
import { KIT_ROOT } from './kit-root';

// `new` copies the starter template: a counter that uses k/v, a record bound
// to a thread, a timer, and a small panel.

/** Copy the template into `targetDir`, which must be missing or empty. */
export async function scaffold(targetDir: string): Promise<void> {
  const target = resolve(targetDir);
  const existing = await readdir(target).catch(() => null);
  if (existing?.length) throw new BuildError(`${target} already exists and isn't empty`);

  await cp(join(KIT_ROOT, 'template'), target, { recursive: true });
  // npm drops files named .gitignore when publishing a package, so the template carries it without the dot.
  await rename(join(target, 'gitignore'), join(target, '.gitignore'));

  const packagePath = join(target, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.name = basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  // This kit's own checkout, until the kit is on npm.
  pkg.devDependencies['atmobb-extension-kit'] = `file:${KIT_ROOT.replace(/\/$/, '')}`;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}
