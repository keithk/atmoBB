import { blobCid } from '$lib/avatar/profile-image';
import type { ActorProfile } from '$lib/server/appview';
import { blobUrl } from '$lib/server/profiles';
import { avatarPluginServer } from 'virtual:atmobb/plugins/server';
import { box, img, text, type VNode } from './render';
import { skin } from './palette';

type Fetch = typeof fetch;

async function imageDataUri(fetchFn: Fetch, src: string): Promise<string | null> {
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
}

function presenceDot({ size, presence }: AvatarOptions): VNode | null {
  return presence
    ? box({
        position: 'absolute',
        right: Math.round(size * 0.02),
        bottom: Math.round(size * 0.02),
        width: Math.round(size * 0.2),
        height: Math.round(size * 0.2),
        borderRadius: 999,
        background: presence === 'online' ? skin.online : presence === 'idle' ? skin.idle : skin.offline,
        border: `${Math.max(3, Math.round(size * 0.035))}px solid ${skin.surface}`,
      })
    : null;
}

async function defaultAvatarNode(
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
    return box(
      {
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        background: skin.surface2,
        overflow: 'hidden',
        ...(ring ? { border: `${Math.max(3, Math.round(size * 0.03))}px solid ${skin.accent}` } : {}),
      },
      img(dataUri, { width: size, height: size, objectFit: 'cover' }),
      presenceDot(options),
    );
  }

  const { size, ring = false, radius = size * 0.16 } = options;
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
      ...(ring ? { border: `${Math.max(3, Math.round(size * 0.03))}px solid ${skin.accent}` } : {}),
    },
    text({ color: '#fff', fontSize: Math.round(size * 0.34), fontWeight: 700 }, initials),
    presenceDot(options),
  );
}

/** Build the configured plugin avatar, falling back to core image/monogram rendering. */
export async function profileAvatarNode(
  profile: ActorProfile | null | undefined,
  did: string,
  fetchFn: Fetch,
  options: AvatarOptions,
  label = '',
): Promise<VNode> {
  const defaultAvatar = () => defaultAvatarNode(profile, did, fetchFn, options, label);
  if (avatarPluginServer?.renderAvatar) {
    const rendered = await avatarPluginServer.renderAvatar({
      profile,
      did,
      label,
      fetch: fetchFn,
      options,
      defaultAvatar,
    });
    if (rendered) return rendered;
  }
  return defaultAvatar();
}
