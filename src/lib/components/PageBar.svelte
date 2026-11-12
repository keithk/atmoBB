<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    heading,
    description,
    children,
  }: {
    title?: string;
    /** Rich heading content, for a title that is more than text. */
    heading?: Snippet;
    description?: string;
    /** View switches and page actions, shown after the title. */
    children?: Snippet;
  } = $props();
</script>

<!-- The page's heading and controls, pinned to the top of the content panel. -->
<header class="atm-pagebar">
  <h1 class="atm-pagebar__title">{#if heading}{@render heading()}{:else}{title}{/if}</h1>
  {#if description}<p class="atm-pagebar__desc">{description}</p>{/if}
  {#if children}<div class="atm-pagebar__actions">{@render children()}</div>{/if}
</header>

<style>
  @layer atmobb {
  .atm-pagebar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    min-height: var(--header-h);
    /* Span the panel edge to edge, over its padding. */
    margin: calc(-1 * var(--main-pad-y)) calc(-1 * var(--main-pad-x)) var(--space-4);
    padding: var(--space-2) var(--main-pad-x);
    background: var(--forum-cat-bg);
    border-bottom: var(--border-solid) solid var(--forum-cat-edge);
    border-radius: calc(var(--radius-lg) - 1px) calc(var(--radius-lg) - 1px) 0 0;
    box-shadow: inset 0 1px 0 var(--forum-bevel);
  }
  .atm-pagebar__title {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    margin: 0;
    font: var(--w-bold) var(--text-lg)/1.2 var(--font-display);
    color: var(--forum-cat-ink);
  }
  .atm-pagebar__desc {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: var(--type-ui);
    font-weight: var(--w-regular);
    color: var(--forum-ink-soft);
  }
  .atm-pagebar__actions { display: flex; flex: none; align-items: center; gap: var(--space-2); margin-left: auto; }

  @media (max-width: 860px) {
    .atm-pagebar { flex-wrap: wrap; border-radius: 0; }
    .atm-pagebar__desc { flex-basis: 100%; order: 3; }
  }
  }
</style>
