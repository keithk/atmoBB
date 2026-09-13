<script lang="ts">
  import type { TrayEntry } from '$lib/server/appview';
  import type { StampLook } from '$lib/stamps';
  import { themeInlineStyle, themePreset } from '$lib/themes';
  import StampRow from './StampRow.svelte';

  let { name, look }: { name: string; look: StampLook } = $props();

  // One light and one dark preset: a stamp has to read on both before it ships.
  const themes = [themePreset('classic'), themePreset('midnight')];

  const entry = $derived<TrayEntry>({
    id: 'preview',
    name: name.trim() || 'stamp name',
    source: 'admin',
    look,
  });
</script>

<div class="preview" aria-label="Preview on the light and dark themes">
  {#each themes as theme (theme.value)}
    <div class="preview__theme" style={themeInlineStyle(theme.value)} style:color-scheme={theme.dark ? 'dark' : 'light'}>
      <span class="preview__label">{theme.dark ? 'Dark' : 'Light'} theme</span>
      <div class="preview__rail">
        <span class="preview__avatar" aria-hidden="true"></span>
        <span class="preview__handle">@member.example</span>
        <StampRow stamps={[entry]} size="full" />
      </div>
      <div class="preview__card">
        <span class="preview__handle">@member.example</span>
        <StampRow stamps={[entry]} size="compact" />
      </div>
    </div>
  {/each}
</div>

<style>
  .preview {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--space-3);
  }
  /* Each half reads the same --forum-* tokens the public pages use; the inline
     style re-skins it without touching the admin around it. */
  .preview__theme {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
    background: var(--forum-bg);
    color: var(--forum-ink);
    font: var(--type-ui);
  }
  .preview__label {
    font: var(--w-semibold) var(--text-xs)/1.3 var(--font-body);
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
    color: var(--forum-ink-soft);
  }
  .preview__rail,
  .preview__card {
    display: grid;
    gap: var(--space-2);
    background: var(--forum-surface);
    border: var(--border-hair) solid var(--forum-edge);
    border-radius: var(--radius-md);
    box-shadow: inset 0 1px 0 var(--forum-bevel), var(--shadow-sm);
  }
  .preview__rail { padding: var(--space-3); justify-items: start; }
  .preview__card { padding: var(--space-2); }
  .preview__avatar {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    background: var(--forum-sunken);
    border: var(--border-hair) solid var(--forum-line-strong);
  }
  .preview__handle { font: var(--type-meta); color: var(--forum-ink-soft); }
</style>
