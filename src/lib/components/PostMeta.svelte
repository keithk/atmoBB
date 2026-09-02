<script lang="ts">
  import type { Rank } from '$lib/rank';
  import Avatar from './Avatar.svelte';
  import MemberLink from './MemberLink.svelte';
  import RankBadge from './RankBadge.svelte';

  type PostProfile = {
    avatar?: unknown;
    displayName?: string;
    title?: string;
    createdAt?: string;
    avatarUrl?: string | null;
  };

  let {
    did,
    handle,
    profile,
    presence,
    ranks = [],
    posts = 0,
    totalPosts = 0,
  }: {
    did: string;
    handle?: string;
    profile?: PostProfile | null;
    presence?: 'online' | 'idle' | 'offline';
    ranks?: Rank[];
    posts?: number;
    totalPosts?: number;
  } = $props();

  const readableHandle = $derived(handle && !handle.startsWith('did:') ? handle : did.slice(8, 20));
  const displayName = $derived(profile?.displayName ?? readableHandle);
  const joined = $derived(
    profile?.createdAt
      ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      : null,
  );
</script>

<aside class="atm-postmeta">
  <MemberLink {did} {handle} class="atm-post__avatar-link">
    <Avatar seed={did} {profile} size={100} {presence} />
  </MemberLink>
  <div class="atm-postmeta__identity">
    <MemberLink {did} {handle} class="atm-postmeta__name">{displayName}</MemberLink>
    <span class="atm-postmeta__handle">@{readableHandle}</span>
    {#if profile?.title}<div class="atm-usertitle">{profile.title}</div>{/if}
    <RankBadge {ranks} {posts} />
  </div>
  <div class="atm-postmeta__stats">
    <span class="atm-postmeta__stat"><span>posts</span><b>{posts}</b></span>
    {#if totalPosts > posts}
      <span class="atm-postmeta__stat"><span>atmosphere</span><b>{totalPosts}</b></span>
    {/if}
    {#if joined}
      <span class="atm-postmeta__stat"><span>joined</span><b>{joined}</b></span>
    {/if}
  </div>
</aside>
