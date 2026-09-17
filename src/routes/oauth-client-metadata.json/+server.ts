import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clientMetadata } from '$lib/server/atproto-oauth';
import { refreshExtensionScopes } from '$lib/server/extensions/scopes';

// A PDS only grants scopes it finds here, so serve the current extension scopes.
export const GET: RequestHandler = async () => {
  await refreshExtensionScopes();
  return json(clientMetadata());
};
