/**
 * Pure helpers for a member's personal profile page: which colors and banner
 * the page body wears, and which panels render in what order for whom.
 * Record values arrive unvalidated, so every saved string is used only as a
 * map key; nothing from the record is ever interpolated into style output.
 */
import { FORUM_THEMES, profileSkinStyle, type ForumTheme } from './themes';

/** Pattern drawers, each taking the ink color the lines or dots are drawn in. */
const BANNER_PATTERNS: Record<string, (ink: string) => string> = {
  plain: () => '',
  stars: (ink) =>
    `background-image:radial-gradient(circle at 20% 30%, ${ink} 1.5px, transparent 2px),` +
    `radial-gradient(circle at 70% 65%, ${ink} 1px, transparent 1.5px);background-size:48px 48px`,
  scanlines: (ink) => `background-image:repeating-linear-gradient(0deg, ${ink} 0 1px, transparent 1px 4px)`,
  checker: (ink) =>
    `background-image:conic-gradient(${ink} 25%, transparent 0 50%, ${ink} 0 75%, transparent 0);background-size:24px 24px`,
};

/** Mid-to-dark backgrounds, all dark enough for the white-ish pattern ink. */
const BANNER_SWATCHES: Record<string, string> = {
  coral: '#c8553d',
  rust: '#9a4a24',
  plum: '#6b3a6b',
  berry: '#a3294f',
  navy: '#1f3a68',
  teal: '#1f6f6b',
  pine: '#2f5a3a',
  slate: '#4a5563',
};
export const DEFAULT_SWATCH = 'slate';
/** Banner choices, matching the #banner knownValues in the actor profile lexicon. */
export const BANNER_PATTERN_IDS = Object.keys(BANNER_PATTERNS);
export const BANNER_SWATCH_IDS = Object.keys(BANNER_SWATCHES);
const SWATCH_INK = 'rgb(255 255 255 / 0.4)';

// With skins off the banner follows the forum: accent ground, accent-ink
// pattern, a pairing every preset keeps legible.
const FORUM_BANNER_BG = 'var(--forum-accent)';
const FORUM_BANNER_INK = 'color-mix(in oklch, var(--forum-accent-ink) 45%, transparent)';

export interface ProfileLook {
  /** Inline style for the profile body wrapper; undefined keeps the forum's colors. */
  style: string | undefined;
  banner: { style: string } | null;
  /** A banned owner's page: no skin, banner, headline, currently line, About me, or guestbook. */
  plain: boolean;
}

function own<T>(map: Record<string, T>, key: unknown): T | undefined {
  return typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : undefined;
}

function bannerStyle(banner: unknown, background: string | null, ink: string | null): { style: string } | null {
  if (!banner || typeof banner !== 'object') return null;
  const { pattern, swatch } = banner as { pattern?: unknown; swatch?: unknown };
  const ground = background ?? own(BANNER_SWATCHES, swatch) ?? BANNER_SWATCHES[DEFAULT_SWATCH];
  const draw = own(BANNER_PATTERNS, pattern) ?? BANNER_PATTERNS.plain;
  return { style: [`background-color:${ground}`, draw(ink ?? SWATCH_INK)].filter(Boolean).join(';') };
}

export function profileLook({ profileSkin, banner, forumHidesSkins, ownerBanned }: {
  profileSkin?: unknown;
  banner?: unknown;
  forumHidesSkins: boolean;
  ownerBanned: boolean;
}): ProfileLook {
  if (ownerBanned) return { style: undefined, banner: null, plain: true };
  if (forumHidesSkins) {
    return { style: undefined, banner: bannerStyle(banner, FORUM_BANNER_BG, FORUM_BANNER_INK), plain: false };
  }
  const skin = FORUM_THEMES.includes(profileSkin as ForumTheme) ? profileSkinStyle(profileSkin as ForumTheme) : undefined;
  return { style: skin, banner: bannerStyle(banner, null, null), plain: false };
}

/** Topics a member can pin to their profile page: the membership lexicon's cap. */
export const MAX_PINS = 4;

export type ProfilePanelId =
  | 'about' | 'pinned' | 'stamps' | 'regulars' | 'activity' | 'guestbook' | 'bluesky' | 'signature';

/**
 * Panels the page can render, in default order. Saved ids not listed here
 * are ignored, so a panel ships by adding it here; the full default order is
 * about, pinned, stamps, regulars, activity, guestbook, bluesky, signature.
 */
export const PROFILE_PANELS: readonly ProfilePanelId[] = ['about', 'pinned', 'stamps', 'regulars', 'activity', 'bluesky', 'signature'];

/** Panels a banned owner's plain page leaves out. */
const PLAIN_EXCLUDED: readonly ProfilePanelId[] = ['about', 'guestbook'];

export interface ResolvedPanel {
  id: ProfilePanelId;
  /** content: render it. prompt: empty, owner sees an invitation. stub: owner hid it. */
  state: 'content' | 'prompt' | 'stub';
}

/** Saved order first, then any registered panel the record leaves out, in default order. */
function orderedPanels(panels: unknown): { id: ProfilePanelId; hidden: boolean }[] {
  const saved = Array.isArray(panels) ? panels : [];
  const ordered = new Map<ProfilePanelId, boolean>();
  for (const entry of saved) {
    const id = entry?.id;
    if (PROFILE_PANELS.includes(id) && !ordered.has(id)) ordered.set(id, entry.hidden === true);
  }
  for (const id of PROFILE_PANELS) if (!ordered.has(id)) ordered.set(id, false);
  return [...ordered].map(([id, hidden]) => ({ id, hidden }));
}

/**
 * Which panels render for this viewer. Visitors (and the owner's visitor
 * preview) see only filled, unhidden panels; the owner also sees prompts in
 * empty panels and a stub for hidden ones. The phone chip row lists every
 * rendered panel except stubs.
 */
export function resolvePanels({ panels, hasContent, viewer, plain }: {
  panels: unknown;
  hasContent: Partial<Record<ProfilePanelId, boolean>>;
  viewer: 'owner' | 'visitor';
  plain: boolean;
}): { panels: ResolvedPanel[]; chips: ProfilePanelId[] } {
  const resolved: ResolvedPanel[] = [];
  for (const { id, hidden } of orderedPanels(panels)) {
    if (plain && PLAIN_EXCLUDED.includes(id)) continue;
    const filled = hasContent[id] === true;
    if (viewer === 'visitor') {
      if (filled && !hidden) resolved.push({ id, state: 'content' });
    } else if (hidden) {
      resolved.push({ id, state: 'stub' });
    } else {
      resolved.push({ id, state: filled ? 'content' : 'prompt' });
    }
  }
  return { panels: resolved, chips: resolved.filter((panel) => panel.state !== 'stub').map((panel) => panel.id) };
}
