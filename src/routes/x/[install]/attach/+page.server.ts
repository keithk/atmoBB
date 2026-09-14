import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { threadPath } from '$lib/appview-paths';
import { checkAttach } from '$lib/server/extensions/attach';
import { panelView } from '$lib/server/extensions/panels';

// Staff attach an extension to a thread here: the page draws the extension's
// own attach form in its sandboxed panel, and the panel's attach message goes
// to this route's POST endpoint. The endpoint's checks run first, so a form
// that could only be refused is never shown.

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const thread = url.searchParams.get('thread');
  if (!thread) error(400, 'Choose the thread to attach the extension to.');
  const check = await checkAttach({ installId: params.install, viewerDid: locals.user?.did ?? null, thread });
  if (!check.ok) error(check.status, check.message);
  const panel = panelView(check.install);
  if (!panel) error(422, `${check.install.manifest.name} has no attach form to show.`);
  return { panel, thread, threadHref: threadPath(thread), metadata: { title: `Attach ${panel.name}`, noindex: true } };
};
