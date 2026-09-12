<script lang="ts">
  let { data, form } = $props();

  let faviconName = $state('');
  let ogImageName = $state('');
  let selectedOgTheme = $state<string>();
  const ogTheme = $derived(selectedOgTheme ?? data.ogTheme);
  const ogThemes = [
    { value: 'classic', label: 'Classic', colors: ['#eceae7', '#f79b7a', '#2b2a2e'] },
    { value: 'midnight', label: 'Midnight', colors: ['#171821', '#ffb454', '#f5f1ff'] },
    { value: 'ocean', label: 'Ocean', colors: ['#dcecf1', '#35b6d4', '#14313d'] },
    { value: 'forest', label: 'Forest', colors: ['#e4eadf', '#79a85a', '#243326'] },
    { value: 'plum', label: 'Plum', colors: ['#eee4ed', '#d56aaf', '#382636'] },
  ];
</script>

{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card panel">
  <div class="atm-card__header"><span>Favicon</span></div>
  <div class="atm-card__body">
    <p class="lede">Use your forum’s own icon in browser tabs and bookmarks.</p>
    <div class="favicon-setting">
      <img
        class="favicon-preview"
        src={data.faviconUrl ?? '/favicon.svg'}
        alt="Current forum favicon"
        width="64"
        height="64"
      />
      <div>
        <form class="favicon-actions" method="POST" action="?/uploadFavicon" enctype="multipart/form-data">
          <label class="atm-btn atm-btn--secondary file-button">
            <input
              name="favicon"
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              required
              disabled={data.writeMode === 'index'}
              onchange={(event) => (faviconName = event.currentTarget.files?.[0]?.name ?? '')}
            />
            {faviconName || 'choose image'}
          </label>
          <button class="atm-btn atm-btn--primary" disabled={data.writeMode === 'index'}>save favicon</button>
        </form>
        {#if data.faviconCid}
          <form method="POST" action="?/removeFavicon">
            <button class="atm-btn atm-btn--ghost">restore default</button>
          </form>
        {/if}
        <p class="atm-hint">
          Square PNG, JPEG, or WebP recommended; up to 1 MB.{#if data.writeMode === 'index'} Uploads require a connected forum account and PDS.{/if}
        </p>
      </div>
    </div>
  </div>
</div>

<div class="atm-card panel">
  <div class="atm-card__header"><span>Social preview</span></div>
  <div class="atm-card__body">
    <p class="lede">
      Pick a style and atmoBB builds the image from the forum profile and live stats. No design
      software needed—the preview updates as you choose.
    </p>
    {#if data.ogImageCid}
      <p class="atm-ok">A finished image is currently active. Choosing a style below will replace it.</p>
    {/if}
    <img
      class="og-preview"
      src="/og/forum.png?previewTheme={ogTheme}"
      alt="Current forum social preview"
      width="1200"
      height="630"
    />
    <form class="theme-builder" method="POST" action="?/saveOgTheme">
      <fieldset class="theme-options">
        <legend class="atm-label">Style</legend>
        {#each ogThemes as theme}
          <label class:theme-option--selected={ogTheme === theme.value} class="theme-option">
            <input
              type="radio"
              name="ogTheme"
              value={theme.value}
              checked={ogTheme === theme.value}
              onchange={() => (selectedOgTheme = theme.value)}
            />
            <span class="swatches" aria-hidden="true">
              {#each theme.colors as color}<i style:background={color}></i>{/each}
            </span>
            <span>{theme.label}</span>
          </label>
        {/each}
      </fieldset>
      <button class="atm-btn atm-btn--primary">use this style</button>
    </form>
    <details class="custom-image">
      <summary>Advanced: use a finished image instead</summary>
      <p class="atm-hint">A custom image replaces the generated card until you choose a style again.</p>
      <div class="og-actions">
        <form class="og-upload" method="POST" action="?/uploadOgImage" enctype="multipart/form-data">
          <label class="atm-btn atm-btn--secondary file-button">
            <input
              name="ogImage"
              type="file"
              accept="image/png,.png"
              required
              disabled={data.writeMode === 'index'}
              onchange={(event) => (ogImageName = event.currentTarget.files?.[0]?.name ?? '')}
            />
            {ogImageName || 'choose PNG'}
          </label>
          <button class="atm-btn atm-btn--primary" disabled={data.writeMode === 'index'}>save preview</button>
        </form>
        {#if data.ogImageCid}
          <form method="POST" action="?/removeOgImage">
            <button class="atm-btn atm-btn--ghost">restore default</button>
          </form>
        {/if}
      </div>
      <p class="atm-hint">
        1200 × 630 PNG, up to 2 MB.{#if data.writeMode === 'index'} Uploads require a connected forum account and PDS.{/if}
      </p>
    </details>
  </div>
</div>

<style>
  .panel { max-width: 80ch; margin-bottom: var(--space-4); }
  .lede { margin: 0 0 var(--space-4); font: var(--type-ui); color: var(--forum-ink-soft); }
  .favicon-setting { display: flex; align-items: flex-start; gap: var(--space-4); }
  .favicon-preview { object-fit: contain; border: var(--border-hair) solid var(--forum-line); border-radius: var(--radius-sm); }
  .favicon-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-2); }
  .og-preview { display: block; width: 100%; height: auto; border: var(--border-hair) solid var(--forum-line); }
  .theme-builder { display: grid; gap: var(--space-3); margin-top: var(--space-3); }
  .theme-options { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: 0; border: 0; }
  .theme-options legend { width: 100%; margin-bottom: var(--space-1); }
  .theme-option { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border: var(--border-hair) solid var(--forum-line); background: var(--forum-surface); cursor: pointer; }
  .theme-option--selected { border-color: var(--forum-accent); box-shadow: 0 0 0 1px var(--forum-accent); }
  .theme-option input { position: absolute; opacity: 0; pointer-events: none; }
  .swatches { display: flex; overflow: hidden; border: var(--border-hair) solid var(--forum-line); border-radius: var(--radius-sm); }
  .swatches i { width: 16px; height: 24px; }
  .theme-builder .atm-btn { justify-self: start; }
  .custom-image { margin-top: var(--space-4); border-top: var(--border-hair) solid var(--forum-line); padding-top: var(--space-3); }
  .custom-image summary { cursor: pointer; font: var(--type-ui); color: var(--forum-link); }
  .og-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
  .og-upload { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .file-button { position: relative; max-width: 24rem; overflow: hidden; cursor: pointer; }
  .file-button input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
</style>
