<script lang="ts">
  let { data } = $props();

  type Block = { $type?: string; text?: string };
  const rules = $derived(((data.forum as { rules?: Block[] }).rules ?? []) as Block[]);
</script>

<div class="atm-panel rules">
  <div class="atm-board-section">Rules</div>
  <div class="rules__body">
    {#if rules.length}
      {#each rules as block}
        <p class="rules__block">{block.text}</p>
      {/each}
    {:else}
      <p class="rules__none">
        This forum hasn't posted any rules yet. Until it does, be respectful
        and use your best judgment.
      </p>
      <p class="rules__note">
        When the admins add rules, they'll appear here.
      </p>
    {/if}
  </div>
</div>

<style>
  @layer atmobb {
  .rules { max-width: 72ch; }
  .rules__body {
    background: var(--forum-surface);
    padding: var(--space-5);
    box-shadow: inset 0 1px 0 var(--forum-bevel);
  }
  .rules__block { font: var(--type-body); color: var(--forum-ink); }
  .rules__none { font: var(--type-body); color: var(--forum-ink); }
  .rules__note { font: var(--type-meta); color: var(--forum-ink-soft); }
  }
</style>
