<script lang="ts">
  import { rankFor, type Rank } from '$lib/rank';
  let { ranks = [], posts = 0 }: { ranks?: Rank[]; posts?: number } = $props();
  const current = $derived(rankFor(ranks, posts));
</script>

{#if current.title}
  <span class="atm-rank">
    {current.title}
    {#if ranks.length > 1}
      <span class="atm-rank__pips" aria-hidden="true">
        {#each ranks as _, i}
          <span class="atm-rank__pip {i <= current.index ? '' : 'atm-rank__pip--off'}"></span>
        {/each}
      </span>
    {/if}
  </span>
{/if}
