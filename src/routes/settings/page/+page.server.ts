import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { MAX_PINS, getActorProfile, saveProfile, setPinned, type ProfileEdit } from '$lib/server/pds';
import { agentFor } from '$lib/server/atproto-oauth';
import { FORUM_DID, getBoardIndex, getSpaceRecord, listSpaceRecords, spaceOfBoard } from '$lib/server/appview';
import { parseAtUri } from '$lib/appview-paths';
import { resolveBodyImages, attachImages } from '$lib/server/richtext';
import { parseBBCode, type RichTextBlock } from '$lib/richtext/bbcode';
import { blocksToDoc } from '$lib/richtext/blocks-tiptap';
import { collectImages, docToBBCode } from '$lib/richtext/tiptap-bbcode';
import { forumProfileOverride, profileForForum, type ProfileField } from '$lib/profile-overrides';
import { PROFILE_PANELS, resolvePanels, type ProfilePanelId } from '$lib/profile-page';
import { FORUM_THEMES, type ForumTheme } from '$lib/themes';

const THREAD = 'app.atmobb.discussion.thread';
const MEMBERSHIP = 'app.atmobb.forum.membership';

/** Fields this tab edits; in forum scope each can follow the account default instead. */
const PAGE_FIELDS = ['profileSkin', 'banner', 'headline', 'currently', 'about', 'panels'] as const satisfies readonly ProfileField[];
type PageField = typeof PAGE_FIELDS[number];

// From the #banner knownValues in lexicons/app/atmobb/actor/profile.json.
const BANNER_PATTERNS = ['plain', 'stars', 'scanlines', 'checker'] as const;
const BANNER_SWATCHES = ['coral', 'rust', 'plum', 'berry', 'navy', 'teal', 'pine', 'slate'] as const;
const DEFAULT_SWATCH = 'slate';

const LINE_MAX_GRAPHEMES = 80;
const LINE_MAX_BYTES = 800;
const ABOUT_MAX_BLOCKS = 20;
/** How many of the member's topics the pin picker lists, newest first. */
const TOPIC_LIMIT = 50;
/** listRecords pages read from the member's PDS (100 threads each, across every forum). */
const THREAD_PAGES = 10;

export interface PageValues {
  inherit: PageField[];
  profileSkin: string;
  /** Empty when the page has no banner. */
  bannerPattern: string;
  bannerSwatch: string;
  headline: string;
  currently: string;
  /** About me as BBCode, the shape both the editor and the no-script box post. */
  about: string;
  /** The editor's cid → { blob, alt } image map, as posted. */
  aboutImages: string;
  /** About me reopened in the editor. */
  aboutDoc: ReturnType<typeof blocksToDoc>;
  panels: { id: string; hidden: boolean }[];
  pins: string[];
}

export interface Topic {
  uri: string;
  title: string;
  board: string;
  createdAt: string;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function tooLong(text: string): boolean {
  if (new TextEncoder().encode(text).length > LINE_MAX_BYTES) return true;
  let n = 0;
  for (const _ of segmenter.segment(text)) if (++n > LINE_MAX_GRAPHEMES) return true;
  return false;
}

/** The pinned list on the member's declaration for this forum, read from their PDS. */
async function readPinned(did: string, forum: string): Promise<string[]> {
  const agent = await agentFor(did);
  const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: MEMBERSHIP, limit: 100 });
  const declaration = res.data.records.find((r) => (r.value as { forum?: unknown }).forum === forum);
  const pinned = (declaration?.value as { pinned?: unknown } | undefined)?.pinned;
  return Array.isArray(pinned) ? pinned.filter((uri): uri is string => typeof uri === 'string') : [];
}

/**
 * The member's own topics on this forum: public threads from their PDS whose
 * board is in this forum's repo, plus their threads in each members-only
 * board's space they can read. Newest first.
 */
async function ownTopics(did: string, forum: string): Promise<{ topics: Topic[]; capped: boolean }> {
  const index = await getBoardIndex(forum);
  const boardNames = new Map(index.boards.map((board) => [board.uri, board.value.name]));
  const boardName = (uri: unknown) => (typeof uri === 'string' && boardNames.get(uri)) || 'a board';
  const topics: Topic[] = [];
  const seen = (value: Record<string, unknown>, uri: string) => {
    if (typeof value.board !== 'string' || parseAtUri(value.board)?.did !== forum) return;
    topics.push({
      uri,
      title: typeof value.title === 'string' && value.title ? value.title : 'Untitled topic',
      board: boardName(value.board),
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    });
  };

  const agent = await agentFor(did);
  let cursor: string | undefined;
  let capped = false;
  for (let page = 0; page < THREAD_PAGES; page++) {
    const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: THREAD, limit: 100, cursor });
    for (const record of res.data.records) seen(record.value as Record<string, unknown>, record.uri);
    cursor = res.data.cursor;
    if (!cursor || !res.data.records.length) break;
    if (page === THREAD_PAGES - 1) capped = true;
  }

  const spaces = new Set(index.boards.map((board) => spaceOfBoard(board.value.access)).filter((space): space is string => !!space));
  await Promise.all([...spaces].map(async (space) => {
    try {
      const refs = await listSpaceRecords(did, space, did, THREAD);
      await Promise.all(refs.map(async (ref) => {
        const record = await getSpaceRecord<Record<string, unknown>>(did, space, did, THREAD, ref.rkey).catch(() => null);
        if (record) seen(record.value, record.uri);
      }));
    } catch {
      // Not a member of this board's space, or the space is unreachable: its topics just aren't offered.
    }
  }));

  topics.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.uri.localeCompare(b.uri));
  return { topics, capped: capped || topics.length > TOPIC_LIMIT };
}

/** An About me draft reopened in the editor, keeping the posted image blobs. */
function aboutDraftDoc(about: string, imagesRaw: string): ReturnType<typeof blocksToDoc> {
  let images: Record<string, { blob?: unknown; alt?: string }> = {};
  try {
    const parsed = JSON.parse(imagesRaw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) images = parsed;
  } catch {
    images = {};
  }
  const blocks = parseBBCode(about).flatMap((block) => {
    if (!block.$type.endsWith('#image')) return [block];
    const payload = block.cid ? images[block.cid] : undefined;
    return payload?.blob ? [{ ...block, image: payload.blob, alt: payload.alt }] : [];
  });
  return blocksToDoc(blocks);
}

function readForm(fd: FormData, scope: 'forum' | 'all'): PageValues {
  const text = (name: string) => String(fd.get(name) ?? '');
  const shown = new Set(fd.getAll('show').map(String));
  const about = text('about').trim();
  const aboutImages = text('about__images');
  return {
    inherit: scope === 'forum' ? PAGE_FIELDS.filter((field) => fd.getAll('inherit').includes(field)) : [],
    profileSkin: text('profileSkin'),
    bannerPattern: text('bannerPattern'),
    bannerSwatch: text('bannerSwatch') || DEFAULT_SWATCH,
    headline: text('headline').trim(),
    currently: text('currently').trim(),
    about,
    aboutImages,
    aboutDoc: aboutDraftDoc(about, aboutImages),
    panels: fd.getAll('panel').map(String).map((id) => ({ id, hidden: !shown.has(id) })),
    pins: fd.getAll('pin').map(String),
  };
}

/** `kind:direction:id`, where the id (a topic URI) may itself contain colons. */
function applyMove(values: PageValues, move: string): void {
  const [kind = '', direction = ''] = move.split(':', 2);
  const id = move.slice(kind.length + direction.length + 2);
  const step = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  const list: unknown[] = kind === 'panel' ? values.panels : kind === 'pin' ? values.pins : [];
  const from = list.findIndex((entry) => (kind === 'panel' ? (entry as { id: string }).id : entry) === id);
  const to = from + step;
  if (from < 0 || !step || to < 0 || to >= list.length) return;
  [list[from], list[to]] = [list[to], list[from]];
}

function scopeOf(url: URL): 'forum' | 'all' | null {
  const scope = url.searchParams.get('scope');
  return scope === 'forum' || scope === 'all' ? scope : null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) redirect(302, '/login');
  const did = locals.user.did;
  const forum = FORUM_DID();
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'forum';
  const [accountProfile, pinned, listed] = await Promise.all([
    getActorProfile(did),
    readPinned(did, forum).catch(() => null),
    ownTopics(did, forum).catch(() => null),
  ]);
  const profile = scope === 'forum' ? profileForForum(accountProfile, forum) : accountProfile;
  const overridden = forumProfileOverride(accountProfile, forum)?.fields ?? [];

  const about = (Array.isArray(profile?.about) ? profile.about : []) as RichTextBlock[];
  await resolveBodyImages([{ author: did, body: about }]);
  const aboutDoc = blocksToDoc(about);
  const banner = profile?.banner as { pattern?: unknown; swatch?: unknown } | undefined;
  const bannerPattern = banner && typeof banner === 'object'
    ? (BANNER_PATTERNS as readonly unknown[]).includes(banner.pattern) ? String(banner.pattern) : 'plain'
    : '';
  const bannerSwatch = (BANNER_SWATCHES as readonly unknown[]).includes(banner?.swatch) ? String(banner!.swatch) : DEFAULT_SWATCH;
  const { panels } = resolvePanels({ panels: profile?.panels, hasContent: {}, viewer: 'owner', plain: false });

  const values: PageValues = {
    inherit: scope === 'forum' ? PAGE_FIELDS.filter((field) => !overridden.includes(field)) : [],
    profileSkin: FORUM_THEMES.includes(profile?.profileSkin as ForumTheme) ? String(profile!.profileSkin) : '',
    bannerPattern,
    bannerSwatch,
    headline: typeof profile?.headline === 'string' ? profile.headline : '',
    currently: typeof profile?.currently === 'string' ? profile.currently : '',
    about: docToBBCode(aboutDoc),
    aboutImages: JSON.stringify(collectImages(aboutDoc)),
    aboutDoc,
    panels: panels.map((panel) => ({ id: panel.id, hidden: panel.state === 'stub' })),
    pins: pinned ?? [],
  };

  // Pinned topics stay listed even when older than the newest TOPIC_LIMIT.
  const topics = listed
    ? listed.topics.filter((topic, i) => i < TOPIC_LIMIT || values.pins.includes(topic.uri))
    : null;
  return {
    scope,
    did,
    handle: locals.user.handle,
    avatarProfile: profile,
    values,
    topics,
    topicsCapped: listed?.capped ?? false,
    pinsReadable: pinned !== null && topics !== null,
    maxPins: MAX_PINS,
    topicLimit: TOPIC_LIMIT,
    bannerPatterns: BANNER_PATTERNS,
    bannerSwatches: BANNER_SWATCHES,
  };
};

type Errors = Partial<Record<'profileSkin' | 'banner' | 'headline' | 'currently' | 'about' | 'panels' | 'pins', string>>;

export const actions: Actions = {
  /** Reorder a panel or pin without saving; every other posted field comes back as typed. */
  move: async ({ request, locals, url }) => {
    if (!locals.user) return fail(401, { message: 'Log in to edit your profile page.' });
    const scope = scopeOf(url);
    if (!scope) return fail(400, { message: 'Choose where to apply your profile page.' });
    const fd = await request.formData();
    const values = readForm(fd, scope);
    applyMove(values, String(fd.get('move') ?? ''));
    return { moved: true, values };
  },

  /**
   * Everything is validated before anything is written. Pins go first because
   * only setPinned can find a topic that isn't the member's or isn't on this
   * forum; if it refuses, the profile is left untouched too.
   */
  save: async ({ request, locals, url }) => {
    if (!locals.user) return fail(401, { message: 'Log in to edit your profile page.' });
    const scope = scopeOf(url);
    if (!scope) return fail(400, { message: 'Choose where to apply your profile page.' });
    const did = locals.user.did;
    const forum = FORUM_DID();
    const fd = await request.formData();
    const values = readForm(fd, scope);
    const writes = (field: PageField) => !values.inherit.includes(field);

    const errors: Errors = {};
    if (writes('profileSkin') && values.profileSkin && !FORUM_THEMES.includes(values.profileSkin as ForumTheme)) {
      errors.profileSkin = 'Choose one of the listed skins.';
    }
    if (writes('banner') && values.bannerPattern &&
      (!(BANNER_PATTERNS as readonly string[]).includes(values.bannerPattern) ||
        !(BANNER_SWATCHES as readonly string[]).includes(values.bannerSwatch))) {
      errors.banner = 'Choose one of the listed patterns and colors.';
    }
    if (writes('headline') && tooLong(values.headline)) errors.headline = `Keep your headline to ${LINE_MAX_GRAPHEMES} characters.`;
    if (writes('currently') && tooLong(values.currently)) errors.currently = `Keep this line to ${LINE_MAX_GRAPHEMES} characters.`;
    const about = attachImages(parseBBCode(values.about), values.aboutImages);
    if (writes('about') && about.length > ABOUT_MAX_BLOCKS) {
      errors.about = `About me can have up to ${ABOUT_MAX_BLOCKS} paragraphs, lists, quotes, code blocks or images.`;
    }
    const order = values.panels.map((panel) => panel.id);
    if (writes('panels') &&
      (order.length !== PROFILE_PANELS.length || new Set(order).size !== order.length ||
        !order.every((id) => PROFILE_PANELS.includes(id as ProfilePanelId)))) {
      errors.panels = 'Something went wrong with the panel list. Reload the page and try again.';
    }
    const pinsShown = fd.has('pinsShown');
    if (pinsShown && values.pins.length > MAX_PINS) errors.pins = `You can pin up to ${MAX_PINS} topics.`;
    if (Object.keys(errors).length) {
      return fail(400, { message: 'Fix the highlighted fields, then save again.', errors, values });
    }

    if (pinsShown) {
      try {
        const current = await readPinned(did, forum);
        if (current.join('\n') !== values.pins.join('\n')) await setPinned(did, forum, values.pins);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'We couldn\'t save your pinned topics. Try again.';
        return fail(400, { message: 'Nothing was saved.', errors: { pins: message } satisfies Errors, values });
      }
    }

    const isDefault = order.every((id, i) => id === PROFILE_PANELS[i]) && values.panels.every((panel) => !panel.hidden);
    const edit: ProfileEdit = {};
    if (writes('profileSkin')) edit.profileSkin = values.profileSkin;
    if (writes('banner')) {
      edit.banner = values.bannerPattern ? { pattern: values.bannerPattern, swatch: values.bannerSwatch } : undefined;
    }
    if (writes('headline')) edit.headline = values.headline;
    if (writes('currently')) edit.currently = values.currently;
    if (writes('about')) edit.about = about;
    // The default order with nothing hidden is stored as no order, so panels added later land in their default place.
    if (writes('panels')) {
      edit.panels = isDefault ? [] : values.panels.map(({ id, hidden }) => (hidden ? { id, hidden } : { id }));
    }

    try {
      await saveProfile(did, edit, scope === 'forum' ? forum : undefined, values.inherit);
      return { saved: true };
    } catch (e) {
      return fail(502, {
        message: e instanceof Error ? e.message : 'We couldn\'t save your profile page. Try again.',
        values,
      });
    }
  },
};
