import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { FORUM_DID, getStamps, resolveHandle } from '$lib/server/appview';
import { setWearing } from '$lib/server/pds';
import { savedRedirect } from '$lib/server/saved-redirect';
import { WORN_LIMIT, moveStamp, parseWearing, sponsorDids } from '$lib/stamps';

const HERE = '/settings/stamps';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, '/login');
  const set = await getStamps(FORUM_DID(), locals.user.did);
  const tray = set.tray ?? [];
  // The appview already resolved the declaration against the tray (or picked
  // the defaults for a member who never chose); the page respects the wearing cap.
  const worn = (set.worn ?? []).slice(0, WORN_LIMIT);
  // Every arrival stamp in the tray names its sponsor, worn or not.
  const handles = Object.fromEntries(
    await Promise.all(sponsorDids(tray).map(async (did) => [did, await resolveHandle(did)] as const)),
  );
  return { did: locals.user.did, handle: locals.user.handle, tray, worn, handles };
};

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The enhanced editor submits its complete draft in order. Without JavaScript,
 * move/toggle buttons apply one change and save immediately.
 */
async function save(locals: App.Locals, request: Request, action: 'save' | 'move' | 'toggle') {
  if (!locals.user) return fail(401, { message: 'Log in to choose your stamps.' });
  const did = locals.user.did;
  const form = await request.formData();
  const wear = form.getAll('wear').map(String);
  const move = String(form.get('move') ?? '');
  const set = await getStamps(FORUM_DID(), did).catch(() => null);
  if (!set) return fail(502, { message: "We couldn't read your stamps. Try again.", wear });
  let next = wear;
  if (action === 'move') next = moveStamp(wear, move);
  if (action === 'toggle') {
    const id = String(form.get('toggle') ?? '');
    next = wear.includes(id) ? wear.filter((value) => value !== id) : [...wear, id];
  }
  const parsed = parseWearing(next, set.tray ?? []);
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
  toggle: ({ locals, request }) => save(locals, request, 'toggle'),
};
