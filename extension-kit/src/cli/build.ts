import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, join, posix } from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { build as esbuild, type Message } from 'esbuild';
import { HOST_FUNCTIONS, OPTIONAL_HANDLER_EXPORTS, REQUIRED_HANDLER_EXPORTS, type ExtensionManifest } from '../../../src/lib/extensions/contract';
import { admitExtension, validateManifest, type FieldError } from '../../../src/lib/server/extensions/manifest';
import { BuildError } from './build-error';
import { KIT_ROOT } from './kit-root';
import { ensureToolchain, type ToolchainOptions } from './toolchain';

export { BuildError } from './build-error';

// A build turns an extension project into dist/, laid out the way atmoBB reads
// a release: manifest.json, extension.wasm, the lexicon files at the paths the
// manifest lists, and the UI files beside ui.entry. The manifest goes through
// atmoBB's own admission rules first, so a build that succeeds won't be
// refused at install for anything that can be checked offline.

/** The author's entry module, relative to the project. Its default export is defineExtension(...). */
export const ENTRY = 'src/index.ts';

/** File types atmoBB keeps from a release's UI directory. */
const UI_FILE_TYPES = new Set(['.html', '.js', '.css', '.svg', '.png', '.webp', '.woff2', '.json']);
/** Path segments atmoBB keeps; files with other names are left out of the release. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface BuildOptions {
  projectDir: string;
  toolchain?: ToolchainOptions;
}

export interface BuildResult {
  distDir: string;
  manifest: ExtensionManifest;
  /** Paths written under dist/. */
  files: string[];
  /** The handler exports the module has. */
  exports: string[];
}

const listErrors = (heading: string, errors: FieldError[]) =>
  new BuildError(`${heading}\n${errors.map((error) => `  - ${error.message}`).join('\n')}`);

async function readManifest(projectDir: string): Promise<{ text: string; raw: unknown }> {
  let text: string;
  try {
    text = await readFile(join(projectDir, 'manifest.json'), 'utf8');
  } catch {
    throw new BuildError(`There's no manifest.json in ${projectDir}`);
  }
  try {
    return { text, raw: JSON.parse(text) };
  } catch (error) {
    throw new BuildError(`manifest.json isn't valid JSON: ${(error as Error).message}`);
  }
}

/** The manifest, checked with the same rules atmoBB applies at install. */
async function admit(projectDir: string, raw: unknown): Promise<ExtensionManifest> {
  const shape = validateManifest(raw);
  if (!shape.ok) throw listErrors("manifest.json isn't valid:", shape.errors);
  const lexiconFiles: Record<string, string> = {};
  for (const path of shape.manifest.lexicons) {
    // Paths are already checked to stay inside the project; a missing file is reported by admission.
    const text = await readFile(join(projectDir, path), 'utf8').catch(() => undefined);
    if (text !== undefined) lexiconFiles[path] = text;
  }
  const admission = admitExtension(raw, lexiconFiles);
  if (!admission.ok) throw listErrors('atmoBB would refuse to install this extension:', admission.errors);
  return admission.manifest;
}

function describeEsbuildErrors(errors: Message[]): string {
  return errors
    .map(({ text, location }) => (location ? `  ${location.file}:${location.line}:${location.column + 1}: ${text}` : `  ${text}`))
    .join('\n');
}

/** The author's code and the kit's runtime as one CommonJS script, which is what extism-js compiles. */
async function bundle(projectDir: string, workDir: string): Promise<string> {
  const runtimePath = join(KIT_ROOT, 'src', 'runtime.ts');
  const entry = join(projectDir, ENTRY);
  await readFile(entry).catch(() => {
    throw new BuildError(`There's no ${ENTRY} in ${projectDir}. Its default export is the extension: export default defineExtension({ ... })`);
  });
  const wrapper = join(workDir, 'entry.cjs');
  await writeFile(wrapper, `module.exports = require(${JSON.stringify(runtimePath)}).guestExports(require(${JSON.stringify(entry)}));\n`);
  try {
    const result = await esbuild({
      entryPoints: [wrapper],
      bundle: true,
      write: false,
      format: 'cjs',
      target: 'es2020',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      logLevel: 'silent',
      plugins: [
        {
          name: 'atmobb-extension-kit',
          setup(build) {
            build.onResolve({ filter: /^atmobb-extension-kit$/ }, () => ({ path: runtimePath }));
          },
        },
      ],
    });
    return result.outputFiles[0].text;
  } catch (error) {
    const errors = (error as { errors?: Message[] }).errors;
    if (errors?.length) throw new BuildError(`Bundling ${ENTRY} failed:\n${describeEsbuildErrors(errors)}`);
    throw error;
  }
}

/**
 * Which handlers the bundle exports, found by loading it outside the sandbox.
 * The compiler has to be told the export names up front.
 */
function handlerExports(code: string): string[] {
  const module = { exports: {} as Record<string, unknown> };
  try {
    const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
    runInNewContext(code, { module, exports: module.exports, console: quiet, TextEncoder, TextDecoder }, { timeout: 5_000 });
  } catch (error) {
    throw new BuildError(`${ENTRY} threw while loading: ${error instanceof Error ? error.message : String(error)}`);
  }
  const known: readonly string[] = [...REQUIRED_HANDLER_EXPORTS, ...OPTIONAL_HANDLER_EXPORTS];
  return Object.keys(module.exports).filter((name) => known.includes(name));
}

/** The export and import declarations extism-js compiles against. */
function interfaceFile(exports: string[]): string {
  const exported = exports.map((name) => `  export function ${name}(): I32;`).join('\n');
  const imported = Object.keys(HOST_FUNCTIONS)
    .map((name) => `    ${name}(ptr: I64): I64;`)
    .join('\n');
  return `declare module 'main' {\n${exported}\n}\n\ndeclare module 'extism:host' {\n  interface user {\n${imported}\n  }\n}\n`;
}

async function compile(script: string, exports: string[], workDir: string, toolchain: ToolchainOptions | undefined): Promise<Uint8Array> {
  const tools = await ensureToolchain(toolchain);
  const scriptPath = join(workDir, 'extension.js');
  const interfacePath = join(workDir, 'extension.d.ts');
  const wasmPath = join(workDir, 'extension.wasm');
  await writeFile(scriptPath, script);
  await writeFile(interfacePath, interfaceFile(exports));
  try {
    await promisify(execFile)(tools.extismJs, [scriptPath, '-i', interfacePath, '-o', wasmPath], {
      env: { ...process.env, PATH: [...tools.binDirs, process.env.PATH].filter(Boolean).join(delimiter) },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const { stderr, message } = error as { stderr?: string; message: string };
    throw new BuildError(`extism-js couldn't compile the bundle:\n${(stderr || message).trim()}`);
  }
  return readFile(wasmPath);
}

/** Files under `dir` (relative to the project) that atmoBB keeps as UI files. */
async function uiFiles(projectDir: string, dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string) => {
    for (const entry of await readdir(join(projectDir, relative), { withFileTypes: true })) {
      if (!SAFE_SEGMENT.test(entry.name)) continue;
      const path = posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && UI_FILE_TYPES.has(extname(entry.name).toLowerCase())) found.push(path);
    }
  };
  await walk(dir);
  return found;
}

async function releaseFiles(projectDir: string, manifest: ExtensionManifest): Promise<string[]> {
  const files = [...manifest.lexicons];
  if (manifest.ui) {
    const dir = posix.dirname(manifest.ui.entry);
    if (dir === '.') throw new BuildError('ui.entry must be inside a directory, like "ui/index.html", so the release only carries UI files');
    if (!UI_FILE_TYPES.has(extname(manifest.ui.entry).toLowerCase())) {
      throw new BuildError(`ui.entry ${manifest.ui.entry} isn't a file type atmoBB serves (${[...UI_FILE_TYPES].join(' ')})`);
    }
    const ui = await uiFiles(projectDir, dir).catch((): string[] => []);
    if (!ui.includes(manifest.ui.entry)) throw new BuildError(`ui.entry ${manifest.ui.entry} isn't in the project`);
    files.push(...ui.filter((path) => !files.includes(path)));
  }
  return files;
}

/** Build the project at `projectDir` into its dist/ directory. dist/ is only replaced when the build succeeds. */
export async function build({ projectDir, toolchain }: BuildOptions): Promise<BuildResult> {
  const { text, raw } = await readManifest(projectDir);
  const manifest = await admit(projectDir, raw);
  const copied = await releaseFiles(projectDir, manifest);

  const workDir = await mkdtemp(join(tmpdir(), 'atmobb-extension-build-'));
  try {
    const script = await bundle(projectDir, workDir);
    const exports = handlerExports(script);
    const wasm = await compile(script, exports, workDir, toolchain);

    const distDir = join(projectDir, 'dist');
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir);
    await writeFile(join(distDir, 'manifest.json'), text);
    await writeFile(join(distDir, 'extension.wasm'), wasm);
    for (const path of copied) {
      await mkdir(dirname(join(distDir, path)), { recursive: true });
      await writeFile(join(distDir, path), await readFile(join(projectDir, path)));
    }
    return { distDir, manifest, files: ['manifest.json', 'extension.wasm', ...copied].sort(), exports };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
