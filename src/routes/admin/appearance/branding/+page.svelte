<script lang="ts">
  let { data, form } = $props();

  let faviconName = $state('');
  let ogImageName = $state('');
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
      atmoBB builds social images from the forum profile, live stats, and the same theme tokens used
      by public pages. Theme changes and <code>:root</code> token overrides in Custom CSS update every
      generated forum, thread, and member image automatically.
    </p>
    {#if data.ogImageCid}
      <p class="atm-ok">A finished image is currently active. The generated version is shown below for comparison.</p>
    {/if}
    <img
      class="og-preview"
      src="/og/forum.png?generated"
      alt="Generated forum social preview using the current forum appearance"
      width="1200"
      height="630"
    />
    <p class="atm-hint appearance-note">
      The image renderer supports the shared color, presence, radius, and shadow tokens. Custom CSS
      rules that target page elements or classes still apply only to browser pages.
    </p>
    {#if data.ogImageCid}
      <form class="generated-action" method="POST" action="?/removeOgImage">
        <button class="atm-btn atm-btn--primary">use generated preview</button>
      </form>
    {/if}
    <details class="custom-image">
      <summary>Advanced: use a finished image instead</summary>
      <p class="atm-hint">A custom image replaces the generated forum card until you switch back above.</p>
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
      </div>
      <p class="atm-hint">
        1200 × 630 PNG, up to 2 MB.{#if data.writeMode === 'index'} Uploads require a connected forum account and PDS.{/if}
      </p>
    </details>
  </div>
</div>

<div class="atm-card panel">
  <div class="atm-card__header"><span>Footer</span></div>
  <div class="atm-card__body">
    <form class="credit-form" method="POST" action="?/saveCredit">
      <label class="credit-check">
        <input type="checkbox" name="showCredit" checked={!data.hideCredit} />
        <span>
          <b>Show “powered by atmobb” in the footer</b>
          <small>A small badge linking to the atmobb project. The forum works the same either way.</small>
        </span>
      </label>
      <button class="atm-btn atm-btn--primary">save footer</button>
    </form>
  </div>
</div>

<style>
  .panel { max-width: 80ch; margin-bottom: var(--space-4); }
  .credit-form { display: grid; gap: var(--space-3); justify-items: start; }
  .credit-check { display: flex; align-items: flex-start; gap: var(--space-2); font: var(--type-ui); }
  .credit-check input { margin-top: 3px; }
  .credit-check span { display: grid; gap: 2px; }
  .credit-check b { font-weight: var(--w-semibold); }
  .credit-check small { color: var(--forum-ink-soft); }
  .lede { margin: 0 0 var(--space-4); font: var(--type-ui); color: var(--forum-ink-soft); }
  .favicon-setting { display: flex; align-items: flex-start; gap: var(--space-4); }
  .favicon-preview { object-fit: contain; border: var(--border-hair) solid var(--forum-line); border-radius: var(--radius-sm); }
  .favicon-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-2); }
  .og-preview { display: block; width: 100%; height: auto; border: var(--border-hair) solid var(--forum-line); }
  .lede code { font-family: var(--font-mono); }
  .appearance-note { margin-top: var(--space-2); }
  .generated-action { margin-top: var(--space-3); }
  .custom-image { margin-top: var(--space-4); border-top: var(--border-hair) solid var(--forum-line); padding-top: var(--space-3); }
  .custom-image summary { cursor: pointer; font: var(--type-ui); color: var(--forum-link); }
  .og-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
  .og-upload { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .file-button { position: relative; max-width: 24rem; overflow: hidden; cursor: pointer; }
  .file-button input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
</style>
