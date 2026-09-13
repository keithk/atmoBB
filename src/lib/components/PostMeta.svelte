<script lang="ts">
  import Avatar from './Avatar.svelte';
  import MemberLink from './MemberLink.svelte';
  import { hereSince } from '$lib/profile-card';

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
  }: {
    did: string;
    handle?: string;
    profile?: PostProfile | null;
    presence?: 'online' | 'idle' | 'offline';
  } = $props();

  const readableHandle = $derived(handle && !handle.startsWith('did:') ? handle : did.slice(8, 20));
  const displayName = $derived(profile?.displayName ?? readableHandle);
  const since = $derived(hereSince(profile?.createdAt));
</script>

<aside class="atm-postmeta">
  <MemberLink {did} {handle} class="atm-post__avatar-link">
    <Avatar seed={did} {profile} size={100} {presence} />
  </MemberLink>
  <div class="atm-postmeta__identity">
    <MemberLink {did} {handle} class="atm-postmeta__name">{displayName}</MemberLink>
    <span class="atm-postmeta__handle">@{readableHandle}</span>
    {#if profile?.title}<div class="atm-usertitle">{profile.title}</div>{/if}
  </div>
  {#if since}
    <div class="atm-postmeta__stats">
      <span class="atm-postmeta__stat"><span>here since</span><b>{since}</b></span>
    </div>
  {/if}
</aside>
