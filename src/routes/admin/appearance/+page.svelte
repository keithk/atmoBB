<script lang="ts">
  import { page } from '$app/state';

  let { data, form } = $props();

  const saved = $derived(page.url.searchParams.get('saved'));
  const pending = $derived(page.url.searchParams.has('pending'));
  const fontSize = (bytes?: number) => bytes ? `${Math.ceil(bytes / 1024)} KB` : '';
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

{#if saved}
  <p class="atm-ok">
    {saved === 'removed'
      ? 'Font removed.'
      : saved === 'font'
        ? 'Font uploaded.'
        : saved === 'og'
          ? 'Social preview saved.'
          : saved === 'og-theme'
            ? 'Social preview style saved.'
          : saved === 'og-removed'
            ? 'Default social preview restored.'
            : 'CSS saved.'}
    {#if pending} The change is taking a few extra seconds to show up here — refresh to see it.{/if}
  </p>
{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

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

<div class="atm-card panel">
  <div class="atm-card__header"><span>Custom CSS</span></div>
  <div class="atm-card__body">
    <p class="lede">
      This stylesheet loads after the built-in theme on every public page. It does not apply to
      Admin pages, so you can always return here to fix it. Prefer <code>--forum-*</code> tokens and
      <code>atm-*</code> classes. Built-in styles are layered, so unlayered rules here override them
      without <code>!important</code>.
    </p>
    <form class="appearance" method="POST" action="?/saveCss">
      <div class="atm-field">
        <span class="atm-label">CSS</span>
        <textarea
          class="atm-textarea code"
          name="customCss"
          rows="18"
          maxlength="100000"
          spellcheck="false"
          placeholder={':root {\n  --forum-link: rebeccapurple;\n}'}>{data.customCss}</textarea>
        <span class="atm-hint">Clearing the field restores the built-in styles. CSS can load external resources, so only use URLs you trust.</span>
      </div>
      <button class="atm-btn atm-btn--primary">save CSS</button>
    </form>
  </div>
</div>

<div class="atm-card panel">
  <div class="atm-card__header"><span>Custom fonts ({data.fonts.length}/12)</span></div>
  <div class="atm-card__body">
    <p class="lede">
      Upload one WOFF or WOFF2 file per face. The family becomes available to the CSS above; set a
      token such as <code>--font-display: 'Forum Display', sans-serif</code> to use it.
    </p>

    {#if data.fonts.length}
      <div class="fonts">
        {#each data.fonts as font}
          <div class="font">
            <div class="font__face">
              <strong>{font.family}</strong>
              <span>{font.weight} · {font.style}{#if fontSize(font.size)} · {fontSize(font.size)}{/if}</span>
            </div>
            <form method="POST" action="?/removeFont">
              <input type="hidden" name="cid" value={font.cid} />
              <input type="hidden" name="family" value={font.family} />
              <input type="hidden" name="weight" value={font.weight} />
              <input type="hidden" name="style" value={font.style} />
              <button class="atm-btn atm-btn--ghost atm-btn--sm">remove</button>
            </form>
          </div>
        {/each}
      </div>
    {/if}

    <form class="upload" method="POST" action="?/uploadFont" enctype="multipart/form-data">
      <div class="atm-field upload__family">
        <span class="atm-label">Family name</span>
        <input class="atm-input" name="family" maxlength="64" required placeholder="Forum Display" />
      </div>
      <div class="atm-field">
        <span class="atm-label">Weight</span>
        <select class="atm-select" name="weight">
          {#each [100, 200, 300, 400, 500, 600, 700, 800, 900] as weight}
            <option value={weight} selected={weight === 400}>{weight}</option>
          {/each}
        </select>
      </div>
      <div class="atm-field">
        <span class="atm-label">Style</span>
        <select class="atm-select" name="style">
          <option value="normal">normal</option>
          <option value="italic">italic</option>
        </select>
      </div>
      <div class="atm-field upload__file">
        <span class="atm-label">Font file</span>
        <input class="atm-input" name="font" type="file" accept=".woff,.woff2,font/woff,font/woff2" required />
      </div>
      <button class="atm-btn atm-btn--secondary" disabled={data.writeMode === 'index' || data.fonts.length >= 12}>upload font</button>
    </form>
    {#if data.writeMode === 'index'}
      <p class="atm-hint upload-note">Font uploads are unavailable in development mode because the test forum has no PDS.</p>
    {:else}
      <p class="atm-hint upload-note">2 MB maximum. If you connected this forum before font support was added, reconnect it on the Connection tab to allow font uploads.</p>
    {/if}
  </div>
</div>

<style>
  .panel { max-width: 80ch; margin-bottom: var(--space-4); }
  .lede { margin: 0 0 var(--space-4); font: var(--type-ui); color: var(--forum-ink-soft); }
  .lede code { font-family: var(--font-mono); }
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
  .appearance { display: grid; gap: var(--space-3); }
  .code { font-family: var(--font-mono); font-size: var(--text-xs); tab-size: 2; }
  .fonts { margin-bottom: var(--space-4); border-top: var(--border-hair) solid var(--forum-line); }
  .font {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .font__face { display: grid; flex: 1; }
  .font__face strong { font: var(--w-semibold) var(--text-sm)/1.4 var(--font-body); }
  .font__face span { font: var(--type-meta); color: var(--forum-ink-faint); }
  .upload {
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) auto auto;
    gap: var(--space-3);
    align-items: end;
  }
  .upload__file { grid-column: 1 / -1; }
  .upload .atm-btn { justify-self: start; }
  .upload-note { margin-top: var(--space-3); }
  @media (max-width: 640px) {
    .upload { grid-template-columns: 1fr 1fr; }
    .upload__family, .upload__file { grid-column: 1 / -1; }
  }
</style>
