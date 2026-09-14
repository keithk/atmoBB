import { relative, resolve } from 'node:path';
import { build } from './build';
import { BuildError } from './build-error';
import { dev } from './dev';
import { scaffold } from './new';
import { ensureToolchain } from './toolchain';

const usage = `Usage: atmobb-extension <command>

  new <directory>       Start an extension from the starter template
  build [project]       Build the project (default: .) into dist/
  dev [project]         Build, then rebuild on every change
                        --forum <url>  the dev forum (default: $ATMOBB_FORUM_URL or http://127.0.0.1:5173)
  toolchain             Download the pinned compiler and print a PATH line for using it by hand`;

async function main(args: string[]) {
  const [command, ...rest] = args;
  switch (command) {
    case 'new': {
      if (!rest[0]) throw new BuildError('Name the directory to create: atmobb-extension new <directory>');
      await scaffold(rest[0]);
      const dir = relative(process.cwd(), resolve(rest[0])) || '.';
      console.log(`Created ${dir}. Next:\n  cd ${dir}\n  npm install\n  npm run dev`);
      return;
    }
    case 'build': {
      const result = await build({ projectDir: resolve(rest[0] ?? '.') });
      console.log(`Built ${result.manifest.name} ${result.manifest.version} into ${result.distDir}:`);
      for (const file of result.files) console.log(`  ${file}`);
      return;
    }
    case 'dev': {
      const forumAt = rest.indexOf('--forum');
      const forum = forumAt >= 0 ? rest.splice(forumAt, 2)[1] : (process.env.ATMOBB_FORUM_URL ?? 'http://127.0.0.1:5173');
      if (!forum) throw new BuildError('--forum needs a URL');
      await dev(rest[0] ?? '.', forum);
      return;
    }
    case 'toolchain': {
      const { binDirs } = await ensureToolchain();
      console.log(`export PATH="${binDirs.join(':')}:$PATH"`);
      return;
    }
    case undefined:
    case '--help':
    case '-h':
      console.log(usage);
      return;
    default:
      throw new BuildError(`Unknown command ${command}\n\n${usage}`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof BuildError ? error.message : error);
  process.exitCode = 1;
});
