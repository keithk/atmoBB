import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import pinnedVersions from '../../compiler-version.json';
import { BuildError } from './build-error';

// The Extism JS compiler turns the bundled JavaScript into a QuickJS
// WebAssembly module, and it shells out to binaryen's wasm-merge and wasm-opt
// along the way. Both are native binaries, so the kit downloads the builds
// compiler-version.json pins, checks each archive's sha256, and keeps them in
// a cache directory shared by every project on the machine.

export interface PinnedDownload {
  url: string;
  sha256: string;
}

export interface CompilerPins {
  extismJs: { release: string; platforms: Record<string, PinnedDownload> };
  binaryen: { release: string; platforms: Record<string, PinnedDownload> };
}

export interface ToolchainOptions {
  /** Where downloads are kept. Defaults to ATMOBB_EXTENSION_KIT_CACHE, then ~/.cache/atmobb-extension-kit. */
  cacheDir?: string;
  /** `<platform>-<arch>`, like darwin-arm64. Defaults to this machine. */
  target?: string;
  pins?: CompilerPins;
  fetch?: (url: string) => Promise<Response>;
}

export interface Toolchain {
  /** The extism-js executable. */
  extismJs: string;
  /** Directories to put in front of PATH: extism-js's own, and binaryen's bin, which extism-js runs wasm-merge and wasm-opt from. */
  binDirs: string[];
}

export function defaultCacheDir(): string {
  if (process.env.ATMOBB_EXTENSION_KIT_CACHE) return process.env.ATMOBB_EXTENSION_KIT_CACHE;
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'atmobb-extension-kit');
}

const exists = (path: string) => access(path).then(
  () => true,
  () => false,
);

function pinFor(tool: string, platforms: Record<string, PinnedDownload>, target: string): PinnedDownload {
  const pin = platforms[target];
  if (!pin) throw new BuildError(`There's no ${tool} build for ${target}; it supports ${Object.keys(platforms).join(', ')}`);
  return pin;
}

async function download(label: string, pin: PinnedDownload, fetchUrl: (url: string) => Promise<Response>, cacheDir: string): Promise<Uint8Array> {
  const failed = (reason: string) =>
    new BuildError(`Couldn't download ${label} from ${pin.url}: ${reason}. Check your network connection and run the build again; downloads are kept in ${cacheDir}.`);
  let bytes: Uint8Array;
  try {
    const response = await fetchUrl(pin.url);
    if (!response.ok) throw failed(`HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof BuildError) throw error;
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    throw failed(cause ? `${(error as Error).message} (${cause})` : error instanceof Error ? error.message : String(error));
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== pin.sha256) {
    throw new BuildError(`The ${label} download from ${pin.url} has sha256 ${actual}, but compiler-version.json expected ${pin.sha256}. Nothing was installed.`);
  }
  return bytes;
}

/**
 * Put `fill`'s output at `target` all at once: it writes into a sibling
 * directory that's renamed into place, so an interrupted download never
 * leaves a half-installed tool behind.
 */
async function installOnce(target: string, fill: (dir: string) => Promise<void>) {
  if (await exists(target)) return;
  await mkdir(join(target, '..'), { recursive: true });
  const staging = await mkdtemp(`${target}.partial-`);
  try {
    await fill(staging);
    await rename(staging, target).catch(async (error) => {
      // Another build finished the same install first.
      if (!(await exists(target))) throw error;
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The pinned extism-js and binaryen for this machine, downloading whichever isn't cached yet. */
export async function ensureToolchain(options: ToolchainOptions = {}): Promise<Toolchain> {
  const pins = options.pins ?? (pinnedVersions as CompilerPins);
  const target = options.target ?? `${process.platform}-${process.arch}`;
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const fetchUrl = options.fetch ?? ((url: string) => fetch(url));

  const extismPin = pinFor('extism-js', pins.extismJs.platforms, target);
  const binaryenPin = pinFor('binaryen', pins.binaryen.platforms, target);

  const extismDir = join(cacheDir, `extism-js-${pins.extismJs.release}-${target}`);
  await installOnce(extismDir, async (dir) => {
    const archive = await download(`extism-js ${pins.extismJs.release}`, extismPin, fetchUrl, cacheDir);
    const binary = join(dir, 'extism-js');
    await writeFile(binary, gunzipSync(archive));
    await chmod(binary, 0o755);
  });

  const binaryenDir = join(cacheDir, `binaryen-${pins.binaryen.release}-${target}`);
  await installOnce(binaryenDir, async (dir) => {
    const archive = await download(`binaryen ${pins.binaryen.release}`, binaryenPin, fetchUrl, cacheDir);
    const tarball = join(dir, 'binaryen.tar.gz');
    await writeFile(tarball, archive);
    // Every binaryen release archive holds one binaryen-<release>/ directory.
    await promisify(execFile)('tar', ['-xzf', tarball, '-C', dir, '--strip-components', '1']);
    await rm(tarball);
  });

  return {
    extismJs: join(extismDir, 'extism-js'),
    binDirs: [extismDir, join(binaryenDir, 'bin')],
  };
}
