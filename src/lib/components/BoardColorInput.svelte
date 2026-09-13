<script lang="ts">
  import { normalizeBoardColor } from '$lib/board-presentation';

  let {
    id,
    value = '',
    describedBy,
  }: {
    id: string;
    value?: string;
    describedBy?: string;
  } = $props();

  let color = $state('');
  color = value;
  const pickerColor = $derived(normalizeBoardColor(color) ?? '#1a73e8');
</script>

<div class="board-color">
  <input
    class="board-color__picker"
    type="color"
    value={pickerColor}
    aria-label="Choose board color"
    title="Choose board color"
    oninput={(event) => (color = event.currentTarget.value)}
  />
  <input
    class="atm-input board-color__hex"
    {id}
    name="color"
    bind:value={color}
    pattern={'#[0-9A-Fa-f]{6}'}
    maxlength="7"
    placeholder="#1a73e8 (optional)"
    aria-describedby={describedBy}
  />
</div>

<style>
  .board-color {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
  }
  .board-color__picker {
    width: 42px;
    min-height: 38px;
    flex: none;
    padding: 3px;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-md);
    background: var(--forum-surface);
    cursor: pointer;
  }
  .board-color__hex {
    min-width: 0;
    flex: 1;
    font-family: var(--font-mono);
  }
</style>
