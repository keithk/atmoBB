<script lang="ts">
  import { THEME_PRESETS, type ForumTheme } from '$lib/themes';

  let { data, form } = $props();

  let selected = $state<ForumTheme>();
  const theme = $derived(selected ?? data.theme);
</script>

{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card panel">
  <div class="atm-card__header"><span>Theme</span></div>
  <div class="atm-card__body">
    <p class="lede">
      Pick a built-in theme for every public page. A theme sets the forum's colors, type and layout;
      light themes switch to their dark version for visitors whose device is in dark mode. Custom CSS
      still loads afterwards and can fine-tune anything.
    </p>

    <!-- The forum's own home page in the chosen theme; nothing is saved until the form is. -->
    <div class="preview">
      <iframe class="preview__frame" src="/?previewTheme={theme}" title="Preview of the home page in this theme" tabindex="-1" inert></iframe>
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

<div class="atm-card panel">
  <div class="atm-card__header"><span>Member profile pages</span></div>
  <div class="atm-card__body">
    <form class="skins" method="POST" action="?/setHideProfileSkins">
      <label class="skins__check">
        <input type="checkbox" name="hideProfileSkins" checked={data.hideProfileSkins} />
        <span>
          <b>Show member profile pages in this forum's colors</b>
          <small>Ignore members' profile skins. Their banner patterns and headlines still show.</small>
        </span>
      </label>
      <button class="atm-btn atm-btn--primary atm-btn--sm">save</button>
    </form>
  </div>
</div>

<style>
  .panel { max-width: 80ch; margin-bottom: var(--space-4); }
  .lede { margin: 0 0 var(--space-4); font: var(--type-ui); color: var(--forum-ink-soft); }

  /* Live preview: the real home page, drawn at desktop width and scaled down to fit. */
  .preview {
    container-type: inline-size;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
  }
  .preview__frame {
    width: 1280px;
    height: 720px;
    border: 0;
    transform-origin: top left;
    /* container width over frame width, as a plain number */
    scale: tan(atan2(100cqw, 1280px));
  }

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

  .skins { display: grid; gap: var(--space-3); justify-items: start; }
  .skins__check { display: flex; gap: var(--space-2); align-items: flex-start; font: var(--type-ui); }
  .skins__check input { margin-top: 4px; }
  .skins__check span { display: grid; gap: 2px; }
  .skins__check b { font-weight: var(--w-semibold); }
  .skins__check small { color: var(--forum-ink-soft); }
</style>
