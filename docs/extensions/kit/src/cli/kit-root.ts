import { fileURLToPath } from 'node:url';

/**
 * The kit's own directory, for the template and the runtime source. This file
 * is two levels below it, and so is lib/cli/index.mjs, the bundle it's built into.
 */
export const KIT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
