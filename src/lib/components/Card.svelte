<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, children }: { title?: string; children: Snippet } = $props();
</script>

<section class="atm-card">
  {#if title}
    <header class="atm-card__header">{title}</header>
  {/if}
  <div class="atm-card__body">
    {@render children()}
  </div>
</section>
