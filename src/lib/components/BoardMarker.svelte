<script lang="ts">
  import { normalizeBoardColor } from '$lib/board-presentation';

  let { color, class: className = '' }: { color?: unknown; class?: string } = $props();
  const safeColor = $derived(normalizeBoardColor(color));
</script>

<span
  class="atm-board-marker {className}"
  class:atm-board-marker--custom={safeColor}
  style:--atm-board-color={safeColor}
  aria-hidden="true"
></span>

<style>
  @layer atmobb {
  .atm-board-marker {
    display: inline-block;
    width: 0.72em;
    height: 0.72em;
    flex: none;
    border-radius: 2px;
    background: var(--atm-board-color, var(--forum-accent));
  }
  }
</style>
