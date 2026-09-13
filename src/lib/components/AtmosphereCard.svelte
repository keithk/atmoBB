<script lang="ts">
  import type { Snippet } from 'svelte';

  // Framed pitch card: the atmosphere mark orbiting in a tinted side panel,
  // with the pitch copy and actions in the content column. `badge` is a small
  // glyph pinned to the mark (↩ on the reply gate, → on the login card).
  let { badge = '', children }: { badge?: string; children: Snippet } = $props();
</script>

<section class="atm-card atm-card--edge atm-pitch">
  <div class="atm-pitch__art" aria-hidden="true">
    <span class="atm-pitch__orbit atm-pitch__orbit--one"></span>
    <span class="atm-pitch__orbit atm-pitch__orbit--two"></span>
    <span class="atm-pitch__mark">
      <img src="/atmo/atmosphere-mark.svg" alt="" width="48" height="48" />
    </span>
    {#if badge}<span class="atm-pitch__badge">{badge}</span>{/if}
  </div>

  <div class="atm-pitch__content">
    {@render children()}
  </div>
</section>
