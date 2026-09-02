import type { LayoutServerLoad } from './$types';
import { getBoardIndex, FORUM_DID, type ForumProfile } from '$lib/server/appview';
import { getMembership, getOwnAvatarProfile } from '$lib/server/pds';
import { forumUnclaimed, staffRole } from '$lib/server/admin';
import { getStanding } from '$lib/server/appview';
import { ringForums } from '$lib/server/webring';
import { blobCid, blobUrl } from '$lib/server/profiles';

const FONT_FAMILY = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;
const cssString = (value: string) => JSON.stringify(value).replaceAll('<', '\\3c ');

async function customFontCss(profile: ForumProfile): Promise<string> {
  const rules = await Promise.all((profile.customFonts ?? []).map(async (font) => {
    const source = font.source as { mimeType?: unknown };
    const cid = blobCid(font.source);
    const family = typeof font.family === 'string' && FONT_FAMILY.test(font.family) ? font.family : null;
    const weight = Number.isInteger(font.weight) && font.weight >= 100 && font.weight <= 900
      ? font.weight
      : null;
    const style = font.style === 'normal' || font.style === 'italic' ? font.style : null;
    const format = source.mimeType === 'font/woff2' ? 'woff2' : source.mimeType === 'font/woff' ? 'woff' : null;
    if (!cid || !family || !weight || !style || !format) return '';
    const url = await blobUrl(FORUM_DID(), cid);
    if (!url) return '';
    return `@font-face{font-family:${cssString(family)};src:url(${cssString(url)}) format(${cssString(format)});font-weight:${weight};font-style:${style};font-display:swap;}`;
  }));
  return rules.join('\n');
}

function safeCustomCss(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Records normally pass through the admin validator. This also keeps a
  // malformed federated record from ever terminating the generated style tag.
  return value.slice(0, 100_000).replace(/<\/style/gi, '\\3c /style');
}

export const load: LayoutServerLoad = async ({ locals, route }) => {
  // The app must render (degraded) even when the appview is unreachable —
  // health checks hit `/`, and a reads-down forum should still say so politely.
  let forum: ForumProfile = { name: 'atmoBB' };
  let forumFontCss = '';
  let forumCustomCss = '';
  let forumFavicon: { url: string; mimeType: string } | null = null;
  let appviewDown = false;
  // 404s (route.id === null) also render this layout. Never call the appview
  // for them: if HAPPYVIEW_URL ever routes back to this app (e.g. the appview
  // domain isn't assigned yet), layout-on-404 would recurse into a request
  // loop that floods the box.
  if (!route.id) {
    return { user: locals.user, membership: null, avatarProfile: null, admin: false, staffRole: null, bans: [], ringSize: 0, forum, forumDid: FORUM_DID(), forumFontCss, forumCustomCss, forumFavicon, appviewDown: true };
  }
  const [membership, avatarProfile, role, ring, standing] = await Promise.all([
    locals.user ? getMembership(locals.user.did, FORUM_DID()) : null,
    locals.user ? getOwnAvatarProfile(locals.user.did).catch(() => null) : null,
    staffRole(locals.user?.did),
    ringForums(),
    // A banned member is told so on every page.
    locals.user ? getStanding(locals.user.did, FORUM_DID()).catch(() => null) : null,
    (async () => {
      try {
        const index = await getBoardIndex(FORUM_DID());
        if (index.forum) {
          forum = index.forum;
          forumFontCss = await customFontCss(forum);
          forumCustomCss = safeCustomCss(forum.customCss);
          const cid = blobCid(forum.favicon);
          const source = forum.favicon as { mimeType?: unknown } | undefined;
          const mimeType = ['image/png', 'image/jpeg', 'image/webp'].includes(String(source?.mimeType))
            ? String(source?.mimeType)
            : null;
          const url = cid && mimeType ? await blobUrl(FORUM_DID(), cid) : null;
          if (url && mimeType) forumFavicon = { url, mimeType };
        }
      } catch {
        appviewDown = true;
      }
    })(),
  ]);
  return {
    user: locals.user,
    membership,
    avatarProfile,
    admin: role === 'admin',
    staffRole: role,
    // A forum with no staff yet shows every logged-in visitor the setup
    // tab; completing setup still requires the forum account's own OAuth.
    forumUnclaimed: locals.user ? await forumUnclaimed() : false,
    bans: standing?.bans ?? [],
    ringSize: ring.length,
    forum,
    forumDid: FORUM_DID(),
    forumFontCss,
    forumCustomCss,
    forumFavicon,
    appviewDown,
  };
};
