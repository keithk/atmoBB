<script lang="ts">
  import { THEME_PRESETS, themeInlineStyle, type ForumTheme } from '$lib/themes';

  let { data, form } = $props();

  let selected = $state<ForumTheme>();
  const theme = $derived(selected ?? data.theme);
  const previewStyle = $derived(themeInlineStyle(theme));
  const preset = $derived(THEME_PRESETS.find((p) => p.value === theme) ?? THEME_PRESETS[0]);
</script>

{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card panel">
  <div class="atm-card__header"><span>Theme</span></div>
  <div class="atm-card__body">
    <p class="lede">
      Pick a built-in color theme for every public page. Themes only change the
      <code>--forum-*</code> tokens, so custom CSS still loads afterwards and can fine-tune anything.
    </p>

    <div class="preview" style={previewStyle} style:color-scheme={preset.dark ? 'dark' : 'light'} aria-hidden="true">
      <div class="preview__masthead">
        <div class="preview__bar">
          <span class="preview__brand">{data.forumName}</span>
          <span class="preview__btn preview__btn--ghost">log in</span>
        </div>
        <div class="preview__nav">
          <span class="preview__nav-item preview__nav-item--active">Boards</span>
          <span class="preview__nav-item">Latest</span>
          <span class="preview__nav-item">Members</span>
        </div>
      </div>
      <div class="preview__section">
        <div class="preview__cat">General</div>
        <div class="preview__row preview__row--pinned">
          <span class="preview__title">Welcome! Read this first</span>
          <span class="preview__meta">pinned · <span class="preview__link">mod</span></span>
        </div>
        <div class="preview__row">
          <span class="preview__title">What are you playing this weekend?</span>
          <span class="preview__meta">42 replies · <span class="preview__rank">regular</span></span>
        </div>
        <div class="preview__row preview__row--alt">
          <span class="preview__title">Introduce yourself</span>
          <span class="preview__meta">7 replies · <span class="preview__link">newcomer</span></span>
        </div>
      </div>
      <div class="preview__actions">
        <span class="preview__btn preview__btn--primary">new topic</span>
        <span class="preview__btn preview__btn--secondary">watch board</span>
      </div>
    </div>

    <form class="theme-form" method="POST" action="?/saveTheme">
      <fieldset class="theme-options">
        <legend class="atm-label">Themes</legend>
        {#each THEME_PRESETS as option}
          <label class:theme-option--selected={theme === option.value} class="theme-option">
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={theme === option.value}
              onchange={() => (selected = option.value)}
            />
            <span class="swatches" aria-hidden="true">
              {#each option.swatches as color}<i style:background={color}></i>{/each}
            </span>
            <span class="theme-option__text">
              <b>{option.label}</b>
              <small>{option.description}</small>
            </span>
          </label>
        {/each}
      </fieldset>
      <button class="atm-btn atm-btn--primary">save theme</button>
    </form>
  </div>
</div>

<style>
  .panel { max-width: 80ch; margin-bottom: var(--space-4); }
  .lede { margin: 0 0 var(--space-4); font: var(--type-ui); color: var(--forum-ink-soft); }
  .lede code { font-family: var(--font-mono); }

  /* Live preview: a compact mock that reads the same --forum-* tokens as the real pages.
     The inline style on the container re-skins it without touching the admin itself. */
  .preview {
    padding: var(--space-4);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
    background: var(--forum-bg);
    color: var(--forum-ink);
    font: var(--type-ui);
    display: grid;
    gap: var(--space-3);
  }
  .preview__masthead, .preview__section {
    background: var(--forum-surface);
    border: var(--border-hair) solid var(--forum-edge);
    border-radius: var(--radius-md);
    box-shadow: inset 0 1px 0 var(--forum-bevel), var(--shadow-sm);
    overflow: hidden;
  }
  .preview__bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-hair) solid var(--forum-line);
    background: var(--forum-header-bg);
  }
  .preview__brand { font: var(--w-bold) var(--text-md)/1 var(--font-display); color: var(--forum-header-ink); }
  .preview__nav {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    background: var(--forum-cat-bg);
    box-shadow: inset 0 1px 0 var(--forum-bevel);
  }
  .preview__nav-item {
    padding: 8px 10px 6px;
    font: var(--w-semibold) var(--text-xs)/1 var(--font-body);
    color: var(--forum-cat-ink);
    border-bottom: var(--border-solid) solid transparent;
  }
  .preview__nav-item--active { color: var(--forum-ink); border-bottom-color: var(--forum-cat-edge); }
  .preview__cat {
    padding: 6px var(--space-3);
    font: var(--w-bold) var(--text-xs)/1 var(--font-body);
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
    color: var(--forum-cat-ink);
    background: var(--forum-cat-bg);
    border-bottom: var(--border-solid) solid var(--forum-cat-edge);
  }
  .preview__row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .preview__row:last-child { border-bottom: 0; }
  .preview__row--alt { background: var(--forum-surface-2); }
  .preview__row--pinned { background: var(--forum-pin-bg); box-shadow: inset 3px 0 0 var(--forum-pin-edge); }
  .preview__title { font-weight: var(--w-semibold); color: var(--forum-ink); }
  .preview__meta { font: var(--type-meta); color: var(--forum-ink-faint); white-space: nowrap; }
  .preview__link { color: var(--forum-link); }
  .preview__rank {
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    color: var(--forum-rank);
    background: var(--forum-rank-bg);
    border: var(--border-hair) solid color-mix(in oklch, var(--forum-rank) 45%, transparent);
  }
  .preview__actions { display: flex; gap: var(--space-2); }
  .preview__btn {
    display: inline-flex;
    padding: 6px 11px;
    border-radius: var(--radius-sm);
    border: var(--border-hair) solid transparent;
    font: var(--w-semibold) var(--text-xs)/1 var(--font-body);
  }
  .preview__btn--primary {
    background: linear-gradient(180deg, color-mix(in oklch, var(--forum-accent) 86%, #fff), var(--forum-accent));
    color: var(--forum-accent-ink);
    border-color: color-mix(in oklch, var(--forum-accent) 68%, #000);
  }
  .preview__btn--secondary { background: var(--forum-surface); color: var(--forum-ink); border-color: var(--forum-line-strong); }
  .preview__btn--ghost { color: var(--forum-ink-soft); }

  .theme-form { display: grid; gap: var(--space-3); margin-top: var(--space-4); }
  .theme-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: var(--space-2); padding: 0; border: 0; }
  .theme-options legend { margin-bottom: var(--space-1); }
  .theme-option {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-sm);
    background: var(--forum-surface);
    cursor: pointer;
  }
  .theme-option:hover { border-color: var(--forum-line-strong); }
  .theme-option--selected { border-color: var(--forum-accent); box-shadow: 0 0 0 1px var(--forum-accent); }
  .theme-option input { position: absolute; opacity: 0; pointer-events: none; }
  .theme-option:has(input:focus-visible) { outline: 2px solid var(--forum-link); outline-offset: 2px; }
  .swatches { display: flex; flex: none; overflow: hidden; border: var(--border-hair) solid var(--forum-line); border-radius: var(--radius-sm); }
  .swatches i { width: 16px; height: 32px; }
  .theme-option__text { display: grid; gap: 2px; font: var(--type-ui); }
  .theme-option__text b { font-weight: var(--w-semibold); }
  .theme-option__text small { color: var(--forum-ink-soft); }
  .theme-form .atm-btn { justify-self: start; }
</style>
