import { box, text, img, h, type VNode } from './render';
import { skin, font, OG, type OgSkin } from './palette';

// --- brand mark --------------------------------------------------------------

const logoSvg = (outer: string, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 14">` +
  `<g fill="${outer}"><rect x="2" y="0" width="12" height="1"/><rect x="1" y="1" width="14" height="7"/>` +
  `<rect x="2" y="8" width="12" height="1"/><rect x="3" y="9" width="6" height="1"/><rect x="3" y="10" width="3" height="1"/></g>` +
  `<g fill="${inner}"><rect x="3" y="2" width="9" height="1"/><rect x="3" y="4" width="9" height="1"/><rect x="3" y="6" width="6" height="1"/></g>` +
  `</svg>`;

const logo = (w: number, outer: string = skin.accent, inner: string = skin.surface): VNode =>
  img(`data:image/svg+xml;base64,${Buffer.from(logoSvg(outer, inner)).toString('base64')}`, {
    width: w,
    height: Math.round((w * 14) / 16),
  });

const wordmark = (size: number, color: string = skin.ink): VNode =>
  text({ fontFamily: font.wordmark, fontWeight: 600, fontSize: size, letterSpacing: '-0.02em', color }, 'atmobb');

const brand = (logoW: number, markSize: number): VNode =>
  box({ alignItems: 'center', gap: Math.round(markSize * 0.4) }, logo(logoW), wordmark(markSize));

// --- frame + header ----------------------------------------------------------

/** The beveled greige page with its inner panel. Body fills the remaining space. */
const frame = (header: VNode, body: VNode, colors: OgSkin = skin): VNode =>
  box(
    {
      width: OG.width,
      height: OG.height,
      padding: 56,
      background: colors.bg,
      fontFamily: font.body,
      color: colors.ink,
    },
    box(
      {
        flex: 1,
        flexDirection: 'column',
        width: '100%',
        background: colors.surface,
        border: `1px solid ${colors.edge}`,
        borderRadius: colors.radius,
        boxShadow: `inset 0 1px 0 ${colors.bevel}, ${colors.shadow}`,
        overflow: 'hidden',
      },
      header,
      body,
    ),
  );

const headerBar = (left: VNode, right: VNode, pad = 24, colors: OgSkin = skin): VNode =>
  box(
    {
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `${pad}px 40px`,
      background: colors.catBg,
      borderBottom: `3px solid ${colors.catEdge}`,
    },
    left,
    right,
  );

const monoLabel = (value: string, color: string = skin.inkSoft, size = 16): VNode =>
  text({ fontFamily: font.mono, fontSize: size, letterSpacing: '0.06em', color }, value);

// --- stat blocks -------------------------------------------------------------

const stat = (value: string, label: string, big = 34, colors: OgSkin = skin): VNode =>
  box(
    { flexDirection: 'column', gap: 3 },
    text({ fontFamily: font.display, fontWeight: 600, fontSize: big, color: colors.ink }, value),
    text(
      { fontFamily: font.mono, fontSize: 13, letterSpacing: '0.08em', color: colors.inkFaint },
      label,
    ),
  );

const onlineStat = (value: string, label: string, colors: OgSkin = skin): VNode =>
  box(
    { flexDirection: 'column', gap: 3 },
    box(
      { alignItems: 'center', gap: 9 },
      box({ width: 12, height: 12, borderRadius: 999, background: colors.online }),
      text({ fontFamily: font.display, fontWeight: 600, fontSize: 34, color: colors.ink }, value),
    ),
    text(
      { fontFamily: font.mono, fontSize: 13, letterSpacing: '0.08em', color: colors.inkFaint },
      label,
    ),
  );

const vline = (h_ = 40, color = skin.lineStrong): VNode => box({ width: 1, height: h_, background: color });

const clamp = (lines: number) => ({
  display: 'block',
  lineClamp: lines,
  overflow: 'hidden',
  flexShrink: 0,
});

// --- 04 · GENERIC / FALLBACK -------------------------------------------------

export interface GenericData {
  host: string;
}

export function genericCard({ host }: GenericData): VNode {
  return frame(
    headerBar(monoLabel('FORUMS ON THE ATMOSPHERE', skin.inkSoft), monoLabel(host, skin.inkSoft, 15)),
    box(
      { flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 },
      box({ alignItems: 'center', gap: 20 }, logo(72), wordmark(78)),
      text(
        {
          fontFamily: font.display,
          fontSize: 32,
          letterSpacing: '-0.01em',
          color: skin.inkSoft,
          maxWidth: 760,
          textAlign: 'center',
        },
        'Independent forums on the atmosphere.',
      ),
      text(
        { fontFamily: font.mono, fontSize: 16, letterSpacing: '0.08em', color: skin.inkFaint },
        'USE YOUR ACCOUNT ACROSS ATMOBB FORUMS',
      ),
    ),
  );
}

// --- 01 · FORUM LANDING ------------------------------------------------------

export interface ForumData {
  name: string;
  handle: string;
  tagline?: string;
  members: number;
  boards: number;
  online: number;
  skin?: OgSkin;
}

const nf = (n: number) => n.toLocaleString('en-US');

export function forumCard({ name, handle, tagline, members, boards, online, skin: colors = skin }: ForumData): VNode {
  const icon = box(
    {
      width: 168,
      height: 168,
      borderRadius: 14,
      background: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.4)',
    },
    logo(104, colors.accentInk, colors.accent),
  );

  return frame(
    headerBar(
      box(
        { alignItems: 'center', gap: 14 },
        logo(34, colors.accent, colors.surface),
        wordmark(26, colors.ink),
        text({ fontFamily: font.display, fontSize: 24, color: colors.inkSoft }, `/ ${name}`),
      ),
      monoLabel(handle, colors.inkSoft, 15),
      24,
      colors,
    ),
    box(
      { flex: 1, alignItems: 'center', gap: 44, padding: '48px 52px' },
      icon,
      box(
        { flexDirection: 'column', gap: 16 },
        text(
          {
            fontFamily: font.display,
            fontSize: 58,
            letterSpacing: '-0.015em',
            color: colors.ink,
            lineHeight: 1.02,
            ...clamp(2),
          },
          name,
        ),
        tagline
          ? text(
              { fontFamily: font.body, fontSize: 23, color: colors.inkSoft, maxWidth: 640, ...clamp(2) },
              tagline,
            )
          : null,
        box(
          { alignItems: 'center', gap: 36, marginTop: 10 },
          stat(nf(members), 'MEMBERS', 34, colors),
          vline(40, colors.lineStrong),
          stat(nf(boards), 'BOARDS', 34, colors),
          vline(40, colors.lineStrong),
          onlineStat(nf(online), 'ONLINE NOW', colors),
        ),
      ),
    ),
    colors,
  );
}

// --- 02 · THREAD -------------------------------------------------------------

export interface ThreadData {
  boardPath: string;
  title: string;
  excerpt?: string;
  image?: string | null;
  authorHandle: string;
  avatar: VNode | null;
  replies: number;
  started?: string;
  skin?: OgSkin;
}

export function threadCard({
  boardPath,
  title,
  excerpt,
  image,
  authorHandle,
  avatar,
  replies,
  started,
  skin: colors = skin,
}: ThreadData): VNode {
  return frame(
    headerBar(
      monoLabel(boardPath, colors.inkSoft),
      box({ alignItems: 'center', gap: 10 }, logo(26, colors.accent, colors.surface), wordmark(19, colors.ink)),
      22,
      colors,
    ),
    box(
      { flex: 1 },
      box(
        {
          flex: 1,
          flexDirection: 'column',
          padding: image ? '34px 38px 32px 42px' : '38px 48px',
        },
        text(
          { fontFamily: font.mono, fontSize: 15, letterSpacing: '0.1em', color: colors.link },
          'THREAD',
        ),
        text(
          {
            fontFamily: font.display,
            fontSize: image ? 42 : 48,
            letterSpacing: '-0.01em',
            color: colors.ink,
            lineHeight: 1.05,
            marginTop: 10,
            ...clamp(2),
          },
          title,
        ),
        excerpt
          ? text(
              {
                fontFamily: font.body,
                fontSize: image ? 23 : 25,
                lineHeight: 1.35,
                color: colors.body,
                marginTop: 20,
                ...clamp(image ? 5 : 4),
              },
              excerpt,
            )
          : null,
        box({ flex: 1 }),
        box(
          {
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `1px solid ${colors.line}`,
            paddingTop: 18,
          },
          box(
            { alignItems: 'center', gap: 14 },
            avatar,
            text(
              { fontFamily: font.body, fontWeight: 600, fontSize: 19, color: colors.ink },
              `@${authorHandle}`,
            ),
          ),
          box(
            { alignItems: 'center', gap: 24 },
            stat(nf(replies), 'REPLIES', 25, colors),
            ...(started ? [vline(32, colors.lineStrong), stat(started, 'STARTED', 25, colors)] : []),
          ),
        ),
      ),
      image
        ? box(
            {
              width: 480,
              background: colors.surface2,
              borderLeft: `1px solid ${colors.line}`,
              overflow: 'hidden',
            },
            img(image, { width: 480, height: '100%', objectFit: 'cover' }),
          )
        : null,
    ),
    colors,
  );
}

// --- 03 · MEMBER PROFILE -----------------------------------------------------

export interface MemberData {
  displayName: string;
  handle: string;
  avatar: VNode | null;
  /** The year the member's profile was created ("here since"). */
  joined?: string | null;
  signature?: string;
  skin?: OgSkin;
}

export function memberCard({
  displayName,
  handle,
  avatar,
  joined,
  signature,
  skin: colors = skin,
}: MemberData): VNode {
  return frame(
    headerBar(
      monoLabel('MEMBER PROFILE', colors.inkSoft),
      box({ alignItems: 'center', gap: 10 }, logo(26, colors.accent, colors.surface), wordmark(19, colors.ink)),
      22,
      colors,
    ),
    box(
      { flex: 1, alignItems: 'center', gap: 48, padding: '40px 52px' },
      box({ flexDirection: 'column', alignItems: 'center', gap: 14 }, avatar),
      box(
        { flex: 1, flexDirection: 'column', gap: 12 },
        text(
          {
            fontFamily: font.display,
            fontSize: 56,
            letterSpacing: '-0.015em',
            color: colors.ink,
            ...clamp(1),
          },
          displayName,
        ),
        text({ fontFamily: font.mono, fontSize: 20, color: colors.link }, `@${handle}`),
        box(
          { alignItems: 'center', gap: 32, marginTop: 8 },
          ...(joined ? [stat(joined, 'HERE SINCE', 30, colors)] : []),
        ),
        signature
          ? text(
              {
                fontFamily: font.serif,
                fontStyle: 'italic',
                fontSize: 24,
                lineHeight: 1.4,
                color: colors.inkSoft,
                borderLeft: `3px solid ${colors.accent}`,
                padding: '6px 0 6px 18px',
                marginTop: 14,
                maxWidth: 560,
                ...clamp(2),
              },
              signature,
            )
          : null,
      ),
    ),
    colors,
  );
}
