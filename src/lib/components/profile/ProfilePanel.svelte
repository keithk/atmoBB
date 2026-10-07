<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ResolvedPanel } from '$lib/profile-page';

  // One panel of a member's profile page. The owner sees an invitation in an
  // empty panel (prompt) and a one-line stub for a panel hidden from visitors.
  let { panel, title, prompt, children }: {
    panel: ResolvedPanel;
    title: string;
    prompt?: Snippet;
    children?: Snippet;
  } = $props();
</script>

{#if panel.state === 'stub'}
  <p class="atm-profile-panel atm-profile-panel--stub" id="panel-{panel.id}">
    <b>{title}</b>
    <span>Hidden from visitors · <a href="/settings/page#panels">show it</a></span>
  </p>
{:else}
  <section
    class="atm-card atm-profile-panel atm-profile-panel--{panel.id} {panel.state === 'prompt' ? 'atm-profile-panel--prompt' : ''}"
    id="panel-{panel.id}"
    aria-labelledby="panel-{panel.id}-title"
  >
    <h2 class="atm-card__header atm-profile-panel__title" id="panel-{panel.id}-title">{title}</h2>
    <div class="atm-card__body atm-profile-panel__body">
      {#if panel.state === 'prompt'}{@render prompt?.()}{:else}{@render children?.()}{/if}
    </div>
  </section>
{/if}

<style>
  @layer atmobb {
    .atm-profile-panel { scroll-margin-top: var(--space-4); }
    .atm-profile-panel__title { margin: 0; color: var(--forum-ink); }
    .atm-profile-panel--prompt .atm-profile-panel__body {
      display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2);
      font: var(--type-body); color: var(--forum-ink-soft);
    }
    .atm-profile-panel--stub {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2);
      margin: 0; padding: var(--space-2) var(--space-4);
      border: var(--border-hair) dashed var(--forum-line-strong); border-radius: var(--radius-md);
      font: var(--type-meta); color: var(--forum-ink-soft);
    }
    .atm-profile-panel--stub b { color: var(--forum-ink); font-weight: var(--w-semibold); }
  }
</style>
