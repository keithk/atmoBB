<script lang="ts">
  import type { ReconnectStatus } from './extensions.server';

  let { reconnect }: { reconnect: ReconnectStatus & { needed: true } } = $props();
</script>

<section class="reconnect" aria-labelledby="reconnect-heading">
  <h2 id="reconnect-heading" class="reconnect__title">Reconnect the forum account</h2>
  {#if reconnect.notConnected}
    <p>
      The forum account isn't connected, so extensions can't publish anything yet. Connect it to grant access to:
    </p>
  {:else}
    <p>
      The forum account's connection doesn't yet allow the records extensions publish. Until you reconnect, they can't
      write to:
    </p>
  {/if}
  <ul class="reconnect__scopes">
    {#each reconnect.missing as scope (scope)}<li><code>{scope.replace(/^repo:/, '')}</code></li>{/each}
  </ul>
  <p class="atm-hint">
    The forum account's server can remember the old permissions for about 10 minutes. If the consent screen doesn't list
    these collections, wait a few minutes and reconnect again.
  </p>
  <a class="atm-btn atm-btn--primary atm-btn--sm reconnect__go" href="/admin/connect">reconnect forum account →</a>
</section>

<style>
  .reconnect {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-4);
    background: var(--warn-bg);
    border: var(--border-hair) solid color-mix(in oklch, var(--warn-1) 40%, transparent);
    border-radius: var(--radius-md);
    color: var(--forum-ink);
    font: var(--type-ui);
    max-width: 72ch;
  }
  .reconnect p { margin: 0; }
  .reconnect__title { margin: 0; font: var(--type-ui); font-weight: var(--w-semibold); }
  .reconnect__scopes { margin: 0; padding-left: var(--space-5); }
  .reconnect__scopes code { font: var(--type-handle); overflow-wrap: anywhere; }
  .reconnect__go { justify-self: start; }
</style>
