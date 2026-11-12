<script lang="ts">
  import { page } from '$app/state';

  const missing = $derived(page.status === 404);
</script>

<div class="atm-error">
  <p class="atm-error__status">{page.status}</p>
  <h1 class="atm-error__title">{missing ? 'Nothing lives at this address.' : 'Something broke on our side.'}</h1>
  <p class="atm-error__body">
    {#if missing}
      The link may be off by a character, or the post was deleted by its author. Posts belong to
      the people who wrote them, so they can take them down.
    {:else}
      {page.error?.message ?? 'The page could not be loaded.'} Posts are safe in their authors'
      accounts. Try again in a minute.
    {/if}
  </p>
  <p class="atm-error__actions">
    <a class="atm-btn atm-btn--primary" href="/">back to the forum</a>
    <a class="atm-btn atm-btn--ghost" href="/latest">latest topics</a>
  </p>
</div>

<style>
  @layer atmobb {
  .atm-error { max-width: 56ch; margin-inline: auto; padding: var(--space-10) 0 var(--space-8); }
  .atm-error__status {
    display: inline-block;
    margin: 0 0 var(--space-4);
    padding-bottom: var(--space-1);
    border-bottom: var(--border-solid) solid var(--forum-cat-edge);
    font: var(--w-medium) var(--text-2xl)/1 var(--font-mono);
    color: var(--forum-ink-faint);
    font-variant-numeric: tabular-nums;
  }
  .atm-error__title { margin: 0 0 var(--space-3); font: var(--type-section); text-wrap: balance; }
  .atm-error__body { color: var(--forum-ink-soft); }
  .atm-error__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-5); }
  }
</style>
