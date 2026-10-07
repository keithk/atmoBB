<script lang="ts">
  import type { TrayEntry } from '$lib/server/appview';
  import { stampDescription, stampLabel, stampOrigin, type Handles } from '$lib/stamps';
  import Stamp from './Stamp.svelte';

  let { entry, handles = {}, size = 'compact' }: {
    entry: TrayEntry;
    handles?: Handles;
    size?: 'full' | 'compact';
  } = $props();

  const id = $props.id();
  const label = $derived(stampLabel(entry, handles));
  let trigger: HTMLButtonElement;
  let panel: HTMLDivElement;

  function place(event: ToggleEvent) {
    if (event.newState !== 'open') return;
    const rect = trigger.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - box.height - 8))}px`;
    panel.style.margin = '0';
  }
</script>

<button
  bind:this={trigger}
  class="stamp-trigger"
  type="button"
  popovertarget={id}
  aria-label="About the {label} stamp"
>
  <Stamp {entry} {handles} {size} />
</button>
<div bind:this={panel} id={id} popover="auto" class="stamp-detail" ontoggle={place}>
  <div class="stamp-detail__head">
    <strong>{label}</strong>
    <button type="button" popovertarget={id} popovertargetaction="hide" class="atm-btn atm-btn--ghost atm-btn--sm">Close</button>
  </div>
  <p>{stampDescription(entry, handles)}</p>
  <small>{stampOrigin(entry)}</small>
</div>

<style>
  @layer atmobb {
    .stamp-trigger {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 24px; min-height: 24px; padding: 0;
      border: 0; border-radius: var(--radius-sm); background: transparent;
      color: inherit; cursor: pointer;
    }
    .stamp-trigger:hover { filter: brightness(0.94); }
    .stamp-detail {
      position: fixed; width: 290px; max-width: calc(100vw - 16px);
      max-height: calc(100dvh - 16px); overflow: auto;
      padding: var(--space-4); border: var(--border-hair) solid var(--forum-line-strong);
      border-radius: var(--radius-md); background: var(--forum-surface); color: var(--forum-ink);
      box-shadow: var(--shadow-lg); font: var(--type-ui); text-align: left;
      overflow-wrap: anywhere;
    }
    .stamp-detail__head { display: flex; align-items: start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-2); }
    .stamp-detail__head strong { font: var(--type-board-title); }
    .stamp-detail p { margin: 0 0 var(--space-2); }
    .stamp-detail small { font: var(--type-meta); color: var(--forum-ink-soft); }
    @media (pointer: coarse) {
      .stamp-trigger { min-width: 36px; min-height: 36px; }
    }
  }
</style>
