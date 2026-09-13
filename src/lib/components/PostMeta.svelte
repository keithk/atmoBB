<script lang="ts">
  import Avatar from './Avatar.svelte';
  import MemberLink from './MemberLink.svelte';
  import StampRow from './StampRow.svelte';
  import { hereSince } from '$lib/profile-card';
  import type { TrayEntry } from '$lib/server/appview';
  import type { Handles } from '$lib/stamps';

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
    stamps = [],
    handles = {},
  }: {
    did: string;
    handle?: string;
    profile?: PostProfile | null;
    presence?: 'online' | 'idle' | 'offline';
    /** The stamps the author wears on this forum; the row caps at three. */
    stamps?: TrayEntry[];
    /** DID to handle, for the sponsor named on an arrival stamp. */
    handles?: Handles;
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
    <StampRow {stamps} {handles} class="atm-postmeta__stamps" />
  </div>
  {#if since}
    <div class="atm-postmeta__stats">
      <span class="atm-postmeta__stat"><span>here since</span><b>{since}</b></span>
    </div>
  {/if}
</aside>
