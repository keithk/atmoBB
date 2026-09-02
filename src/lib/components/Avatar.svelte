<script lang="ts">
  import { profileImagePath } from '$lib/avatar/profile-image';

  type AvatarProfile = {
    avatar?: unknown;
    /** A caller-resolved image URL (compatibility path). */
    avatarUrl?: string | null;
  };

  let {
    seed,
    profile,
    src,
    alt = '',
    size = 32,
    rounded = false,
    ring = false,
    presence,
  }: {
    seed: string;
    profile?: AvatarProfile | null;
    src?: string;
    alt?: string;
    size?: number;
    rounded?: boolean;
    ring?: boolean;
    presence?: 'online' | 'idle' | 'offline';
  } = $props();

  const shownSrc = $derived(
    src ?? profile?.avatarUrl ?? profileImagePath(seed, profile?.avatar) ?? null,
  );
  const fallbackText = $derived.by(() => {
    const words = alt.trim().split(/\s+/).filter(Boolean);
    if (words.length) return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
    return seed.split(':').at(-1)?.slice(0, 2).toUpperCase() || '?';
  });
  const fallbackHue = $derived.by(() => {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    return (hash >>> 0) % 360;
  });
</script>

<span
  class="atm-avatar {rounded ? 'atm-avatar--rounded' : ''} {ring ? 'atm-avatar--ring' : ''}"
  style="width:{size}px;height:{size}px"
>
  {#if shownSrc}
    <img src={shownSrc} {alt} width={size} height={size} loading="lazy" />
  {:else}
    <span
      class="atm-avatar__fallback"
      style="--avatar-hue:{fallbackHue};font-size:{Math.max(9, Math.round(size * 0.34))}px"
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : 'true'}
    >{fallbackText}</span>
  {/if}
  {#if presence}
    <span class="atm-avatar__dot atm-avatar__dot--{presence}" title={presence}></span>
  {/if}
</span>
