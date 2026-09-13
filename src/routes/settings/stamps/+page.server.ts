import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { FORUM_DID, getStamps, resolveHandle } from '$lib/server/appview';
import { setWearing } from '$lib/server/pds';
import { savedRedirect } from '$lib/server/saved-redirect';
import { WORN_LIMIT, parseWearing, sponsorDids } from '$lib/stamps';

const HERE = '/settings/stamps';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, '/login');
  const set = await getStamps(FORUM_DID(), locals.user.did);
  const tray = set.tray ?? [];
  // The appview already resolved the declaration against the tray (or picked
  // the defaults for a member who never chose); the page shows the first three.
  const worn = (set.worn ?? []).slice(0, WORN_LIMIT);
  // Every arrival stamp in the tray names its sponsor, worn or not.
  const handles = Object.fromEntries(
    await Promise.all(sponsorDids(tray).map(async (did) => [did, await resolveHandle(did)] as const)),
  );
  return { did: locals.user.did, tray, worn, handles };
};

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Swap `id` with its neighbor in `ids`; a move past either end is a no-op. */
function moved(ids: string[], move: string): string[] {
  const [dir, id] = move.split(/:(.*)/, 2);
  const at = ids.indexOf(id);
  const to = at + (dir === 'up' ? -1 : 1);
  if (at < 0 || to < 0 || to >= ids.length) return ids;
  const out = [...ids];
  [out[at], out[to]] = [out[to], out[at]];
  return out;
}

/**
 * Write the checked stamps, in the order the form listed them (worn first, so
 * a newly ticked one lands after those). A move reorders before the same
 * write: it saves straight away, like the boards admin list, and the
 * reordered page is its own feedback.
 */
async function save(locals: App.Locals, request: Request, action: 'save' | 'move') {
  if (!locals.user) return fail(401, { message: 'Log in to choose your stamps.' });
  const did = locals.user.did;
  const form = await request.formData();
  const wear = form.getAll('wear').map(String);
  const move = String(form.get('move') ?? '');
  const set = await getStamps(FORUM_DID(), did).catch(() => null);
  if (!set) return fail(502, { message: "We couldn't read your stamps. Try again.", wear });
  const parsed = parseWearing(action === 'move' && move ? moved(wear, move) : wear, set.tray ?? []);
  if (!parsed.ok) return fail(400, { message: parsed.error, wear });
  try {
    await setWearing(did, FORUM_DID(), parsed.ids);
  } catch (e) {
    return fail(502, { message: e instanceof Error ? e.message : "We couldn't save your stamps. Try again.", wear });
  }
  await savedRedirect(
    action === 'save' ? `${HERE}?saved=1` : HERE,
    () => getStamps(FORUM_DID(), did),
    (s) => sameOrder((s.worn ?? []).slice(0, WORN_LIMIT), parsed.ids),
  );
}

export const actions: Actions = {
  save: ({ locals, request }) => save(locals, request, 'save'),
  move: ({ locals, request }) => save(locals, request, 'move'),
};
