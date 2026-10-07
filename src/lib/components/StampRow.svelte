<script lang="ts">
  import type { TrayEntry } from '$lib/server/appview';
  import { wornEntries, type Handles } from '$lib/stamps';
  import StampDetails from './StampDetails.svelte';

  let {
    stamps = [],
    handles = {},
    size = 'compact',
    class: className = '',
  }: {
    stamps?: TrayEntry[];
    handles?: Handles;
    size?: 'full' | 'compact';
    class?: string;
  } = $props();

  const worn = $derived(wornEntries(stamps));
</script>

{#if worn.length}
  <ul class="atm-stamps atm-stamps--{size} {className}">
    {#each worn as entry (entry.id)}
      <li><StampDetails {entry} {handles} {size} /></li>
    {/each}
  </ul>
{/if}
