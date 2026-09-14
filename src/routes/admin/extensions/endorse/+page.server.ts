import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminActor } from '$lib/server/admin';
import { normalizeGitUrl } from '$lib/server/extensions/claims';
import { endorseRelease, listEndorsements, removeReviewedSha } from '$lib/server/extensions/endorsement';
import { directoryEnabled } from '$lib/server/extensions/scopes';
import { parseAtUri } from '$lib/appview-paths';

// atmobb.app staff mark a repository trusted here: which git URL, and which
// release SHAs they reviewed. Only the atmobb.app directory forum runs this
// page (ATMOBB_EXTENSION_DIRECTORY=1) — everywhere else it's a 404, same as a
// feature that's off. Writes go straight to this forum's own repo through the
// forum-repo helpers; every install (including this one) reads the result
// back through endorsementFor.

const SHA_PATTERN = /^[0-9a-f]{7,64}$/;

function refuseUrl(gitUrl: string): string | null {
  try {
    normalizeGitUrl(gitUrl);
    return null;
  } catch {
    return `${gitUrl}: not a valid git URL.`;
  }
}

export const load: PageServerLoad = async ({ locals }) => {
  if (!(await adminActor(locals))) error(403, 'Only admins can manage the extension directory.');
  if (!directoryEnabled()) error(404, 'Not found');
  return { endorsements: await listEndorsements() };
};

export const actions: Actions = {
  endorse: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    if (!directoryEnabled()) error(404, 'Not found');
    const form = await request.formData();
    const gitUrl = String(form.get('gitUrl') ?? '').trim();
    const sha = String(form.get('sha') ?? '').trim().toLowerCase();
    const listing = String(form.get('listing') ?? '').trim();
    const fields = { gitUrl, sha, listing };

    if (!gitUrl) return fail(400, { message: 'Enter the repository’s git URL.', fields });
    const urlProblem = refuseUrl(gitUrl);
    if (urlProblem) return fail(400, { message: urlProblem, fields });
    if (!SHA_PATTERN.test(sha)) return fail(400, { message: 'Enter the release SHA staff reviewed, as hex (7 to 64 characters).', fields });
    if (listing && !parseAtUri(listing)) return fail(400, { message: 'The listing thread must be an at:// URI.', fields });

    try {
      const endorsement = await endorseRelease(gitUrl, sha, listing || undefined);
      return { saved: endorsement.gitUrl };
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : "Couldn't save the endorsement. Try again.", fields });
    }
  },

  removeSha: async ({ request, locals }) => {
    if (!(await adminActor(locals))) return fail(403, { message: 'Only admins can make this change.' });
    if (!directoryEnabled()) error(404, 'Not found');
    const form = await request.formData();
    const gitUrl = String(form.get('gitUrl') ?? '');
    const sha = String(form.get('sha') ?? '');
    try {
      const updated = await removeReviewedSha(gitUrl, sha);
      if (!updated) return fail(404, { message: 'No endorsement holds that repository.' });
      return { removed: { gitUrl, sha } };
    } catch (e) {
      return fail(502, { message: e instanceof Error ? e.message : "Couldn't remove the SHA. Try again." });
    }
  },
};
