<script lang="ts">
  import type { NetworkApp } from '$lib/network-apps';

  let { featured }: { featured: NetworkApp } = $props();
</script>

<a
  class="atm-pitch__apps"
  href="https://atstore.fyi/"
  target="_blank"
  rel="noopener"
  aria-label="Browse more apps on AT Store"
>
  <span class="atm-pitch__appstack" aria-hidden="true">
    <span class="atm-pitch__app"><img src="/atmo/bluesky.svg" alt="" width="28" height="28" /></span>
    <span class="atm-pitch__app"><img src="/atmo/{featured.slug}.svg" alt="" width="28" height="28" /></span>
    <span class="atm-pitch__app atm-pitch__app--more">+</span>
  </span>
  <span>explore more apps on AT Store ↗</span>
</a>
