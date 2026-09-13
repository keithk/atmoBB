<script lang="ts">
  import type { TrayEntry } from '$lib/server/appview';
  import { wornEntries, type Handles } from '$lib/stamps';
  import Stamp from './Stamp.svelte';

  let {
    stamps,
    handles = {},
    size = 'full',
    class: className = '',
  }: {
    stamps: TrayEntry[];
    handles?: Handles;
    size?: 'full' | 'compact';
    class?: string;
  } = $props();

  const worn = $derived(wornEntries(stamps));
</script>

{#if worn.length}
  <ul class="atm-stamps atm-stamps--{size} {className}">
    {#each worn as entry (entry.id)}
      <li><Stamp {entry} {handles} {size} /></li>
    {/each}
  </ul>
{/if}
