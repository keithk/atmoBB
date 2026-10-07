<script lang="ts">
  import { page } from '$app/state';
  import StampCollection from '$lib/components/StampCollection.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { message?: string; wear?: string[] } | null } = $props();
</script>

<svelte:head><title>Your stamps · atmoBB</title></svelte:head>

<StampCollection
  tray={data.tray}
  worn={data.worn}
  handles={data.handles}
  handle={data.handle}
  {form}
  saved={page.url.searchParams.has('saved')}
  pending={page.url.searchParams.has('pending')}
/>
