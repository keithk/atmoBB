import { blobCid } from '$lib/avatar/profile-image';
import type { ActorProfile } from '$lib/server/appview';
import { blobUrl } from '$lib/server/profiles';
import { box, img, text, type VNode } from './render';
import { skin, type OgSkin } from './palette';

type Fetch = typeof fetch;

/** Fetch an image into the self-contained form Satori needs while rendering. */
export async function imageDataUri(fetchFn: Fetch, src: string): Promise<string | null> {
  try {
    const res = await fetchFn(src);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    if (!contentType.startsWith('image/')) return null;
    const bytes = await res.arrayBuffer();
    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch {
    return null;
  }
}

export interface AvatarOptions {
  size: number;
  ring?: boolean;
  presence?: 'online' | 'idle' | 'offline';
  radius?: number;
  skin?: OgSkin;
}

function presenceDot(options: AvatarOptions): VNode | null {
  const { size, presence } = options;
  const colors = options.skin ?? skin;
  return presence
    ? box({
        position: 'absolute',
        right: Math.round(size * 0.02),
        bottom: Math.round(size * 0.02),
        width: Math.round(size * 0.2),
        height: Math.round(size * 0.2),
        borderRadius: 999,
        background: presence === 'online' ? colors.online : presence === 'idle' ? colors.idle : colors.offline,
        border: `${Math.max(3, Math.round(size * 0.035))}px solid ${colors.surface}`,
      })
    : null;
}

/** Render the profile image, or a monogram seeded from the DID when there is none. */
export async function profileAvatarNode(
  profile: ActorProfile | null | undefined,
  did: string,
  fetchFn: Fetch,
  options: AvatarOptions,
  label = '',
): Promise<VNode> {
  const cid = blobCid(profile?.avatar);
  const source = cid ? await blobUrl(did, cid) : undefined;
  const dataUri = source ? await imageDataUri(fetchFn, source) : null;
  if (dataUri) {
    const { size, ring = false, radius = size * 0.16 } = options;
    const colors = options.skin ?? skin;
    return box(
      {
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        background: colors.surface2,
        overflow: 'hidden',
        ...(ring ? { border: `${Math.max(3, Math.round(size * 0.03))}px solid ${colors.accent}` } : {}),
      },
      img(dataUri, { width: size, height: size, objectFit: 'cover' }),
      presenceDot(options),
    );
  }

  const { size, ring = false, radius = size * 0.16 } = options;
  const colors = options.skin ?? skin;
  let hash = 2166136261;
  for (let i = 0; i < did.length; i++) hash = Math.imul(hash ^ did.charCodeAt(i), 16777619);
  const words = label.trim().split(/\s+/).filter(Boolean);
  const initials = words.length
    ? words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
    : did.split(':').at(-1)?.slice(0, 2).toUpperCase() || '?';
  return box(
    {
      position: 'relative',
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius,
      background: `hsl(${(hash >>> 0) % 360}, 38%, 42%)`,
      overflow: 'hidden',
      ...(ring ? { border: `${Math.max(3, Math.round(size * 0.03))}px solid ${colors.accent}` } : {}),
    },
    text({ color: '#fff', fontSize: Math.round(size * 0.34), fontWeight: 700 }, initials),
    presenceDot(options),
  );
}
