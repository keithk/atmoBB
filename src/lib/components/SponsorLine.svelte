<script lang="ts">
  import { profileHref } from '$lib/profile-card';

  // `text` comes from sponsorLine(); when the sponsor resolved, it ends in
  // their @handle, which becomes the link. Display only — nothing hangs on it.
  let { text, handle = null }: { text: string; handle?: string | null } = $props();

  const tag = $derived(handle ? `@${handle}` : '');
  const linked = $derived(!!tag && text.endsWith(tag));
</script>

{#if linked}{text.slice(0, -tag.length)}<a href={profileHref(handle ?? '')}>{tag}</a>{:else}{text}{/if}
