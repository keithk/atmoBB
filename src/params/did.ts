import type { ParamMatcher } from '@sveltejs/kit';

// Matchers run before SvelteKit decodes route parameters. Accept the encoded
// colon emitted by encodeURIComponent as well as a literal DID path segment.
export const match: ParamMatcher = (param) =>
  param.startsWith('did:') || param.toLowerCase().startsWith('did%3a');
