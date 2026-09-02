<script lang="ts">
  let { size = 26, wordmark = true }: { size?: number; wordmark?: boolean } = $props();
  const w = $derived(Math.round((size * 16) / 14));
</script>

<span class="atm-logo" style="gap:{Math.round(size * 0.32)}px">
  <svg
    viewBox="0 0 16 14"
    width={w}
    height={size}
    class="pixelated"
    shape-rendering="crispEdges"
    aria-hidden={wordmark ? 'true' : undefined}
    role={wordmark ? undefined : 'img'}
    aria-label={wordmark ? undefined : 'atmobb'}
  >
    <g fill="var(--forum-accent)">
      <rect x="2" y="0" width="12" height="1" /><rect x="1" y="1" width="14" height="7" />
      <rect x="2" y="8" width="12" height="1" /><rect x="3" y="9" width="6" height="1" /><rect x="3" y="10" width="3" height="1" />
    </g>
    <g fill="var(--forum-surface)">
      <rect x="3" y="2" width="9" height="1" /><rect x="3" y="4" width="9" height="1" /><rect x="3" y="6" width="6" height="1" />
    </g>
  </svg>
  {#if wordmark}
    <span class="atm-logo__word" style="font-size:{Math.round(size * 1.02)}px">atmobb</span>
  {/if}
</span>

<style>
  @layer atmobb {
  .atm-logo {
    display: inline-flex;
    align-items: center;
  }
  .atm-logo svg { display: block; flex: none; }
  .atm-logo__word {
    font-family: var(--font-wordmark);
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--forum-accent);
  }
  }
</style>
