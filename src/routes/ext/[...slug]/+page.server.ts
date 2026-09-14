import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { extensionPage, extensionsRunning } from '$lib/server/extensions/panels';

// An extension's standalone page, addressed by its repository so links
// outlive a reinstall. See $lib/extensions/page-path for the address format.

export const load: PageServerLoad = async ({ url, locals }) => {
  if (!extensionsRunning()) error(503, "Extensions aren't running on this forum right now.");
  const found = await extensionPage(url.pathname);
  if (!found) error(404, 'No extension page lives at this address.');
  return { ...found, signedIn: !!locals.user, metadata: { title: found.panel.name } };
};
