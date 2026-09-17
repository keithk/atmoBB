import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The same stand-ins scripts/build-cli.mjs uses for atmoBB's SvelteKit modules.
    alias: {
      $lib: fileURLToPath(new URL('../src/lib', import.meta.url)),
      '$env/dynamic/private': fileURLToPath(new URL('./src/cli/sveltekit-env.ts', import.meta.url)),
    },
  },
  test: {
    // Compiling a QuickJS module takes several seconds, and the first run downloads the compiler.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
