<script lang="ts">
  import type { TrayEntry } from '$lib/server/appview';
  import { ariaLabel, lookFor, stampLabel, type Handles } from '$lib/stamps';

  let {
    entry,
    handles = {},
    size = 'full',
  }: {
    entry: TrayEntry;
    handles?: Handles;
    size?: 'full' | 'compact';
  } = $props();

  const look = $derived(lookFor(entry));
  // Only a fixed look sets the custom properties; the token look leaves them
  // unset so the theme's --forum-rank tokens draw the stamp.
  const fixed = $derived('bg' in look ? look : null);
  const label = $derived(stampLabel(entry, handles));
</script>

<span
  class="atm-stamp atm-stamp--{look.shape} atm-stamp--{size} atm-stamp--{entry.source}"
  class:atm-stamp--custom={fixed}
  style:--atm-stamp-bg={fixed?.bg}
  style:--atm-stamp-ink={fixed?.ink}
  title={size === 'compact' ? label : undefined}
  role="img"
  aria-label={ariaLabel(entry, handles)}
>{label}</span>
