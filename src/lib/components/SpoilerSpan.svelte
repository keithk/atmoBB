<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  let revealed = $state(false);
</script>

<span
  class="atm-spoiler"
  class:atm-spoiler--revealed={revealed}
  role="button"
  tabindex="0"
  aria-pressed={revealed}
  onclick={() => (revealed = true)}
  onkeydown={(e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    revealed = true;
  }}
>{@render children()}</span>

<style>
  @layer atmobb {
  .atm-spoiler {
    border-radius: var(--radius-xs);
    cursor: pointer;
  }
  .atm-spoiler:not(.atm-spoiler--revealed) {
    background: var(--forum-ink-soft);
    color: transparent;
    user-select: none;
  }
  .atm-spoiler--revealed {
    background: var(--forum-accent-soft);
    cursor: text;
  }
  }
</style>
