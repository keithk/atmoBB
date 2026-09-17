<script lang="ts">
  import { page } from '$app/state';
  import { relTime } from '$lib/reltime';
  import ReconnectStep from './ReconnectStep.svelte';
  import ReleaseReview from './ReleaseReview.svelte';

  let { data, form } = $props();

  const uninstalled = $derived(page.url.searchParams.get('uninstalled'));
  const locked = $derived(!!data.unavailable);
  // Right after a confirm, the action's fresh check is the one to show.
  const reconnect = $derived(form?.reconnect ?? data.reconnect);
</script>

<p class="atm-hint extensions__intro">
  Extensions add features to this forum, like running a game in a thread. Each one is a git repository. It stays on the
  release you install until you choose to update it.
</p>

{#if data.unavailable}<p class="extensions__unavailable">{data.unavailable}</p>{/if}

{#if uninstalled}
  <p class="atm-ok">{uninstalled} is uninstalled. Records it published stay in the forum's account.</p>
{/if}
{#if form?.installed}
  <p class="atm-ok">
    {form.installed.name} is installed{reconnect.needed ? ', with one more step below' : ' and live'}.
    <a href="/admin/extensions/{form.installed.id}">Manage it →</a>
  </p>
{/if}
{#if form?.discarded}<p class="atm-ok">Cancelled. Nothing was installed.</p>{/if}
{#if form?.released}<p class="atm-ok">Released {form.released}. Any extension can now claim it.</p>{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}
{#if form?.errors?.length}
  <div class="atm-err extensions__errors" role="alert">
    <p>This extension can't be installed:</p>
    <ul>
      {#each form.errors as problem, i (i)}<li>{problem.message}</li>{/each}
    </ul>
  </div>
{/if}

{#if reconnect.needed}<ReconnectStep {reconnect} />{/if}

{#if form?.review}
  <ReleaseReview
    review={form.review}
    confirmAction="?/confirm"
    discardAction="?/discard"
    confirmLabel="install {form.review.name}"
    disabled={locked}
  />
{/if}

<div class="atm-card extensions__add">
  <div class="atm-card__header"><span>Add an extension</span></div>
  <div class="atm-card__body">
    <form class="atm-editform" method="POST" action="?/stage">
      <div class="atm-field">
        <label class="atm-label" for="extension-git-url">Git URL</label>
        <input
          id="extension-git-url"
          class="atm-input"
          name="gitUrl"
          type="text"
          inputmode="url"
          placeholder="https://github.com/someone/extension.git"
          value={form?.fields?.gitUrl ?? ''}
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          required
        />
        <span class="atm-hint">Copy it from the extension's directory listing or its repository page.</span>
      </div>
      <div class="atm-field">
        <label class="atm-label" for="extension-tag">Release tag (optional)</label>
        <input
          id="extension-tag"
          class="atm-input extensions__tag"
          name="tag"
          placeholder="v1.0.0"
          value={form?.fields?.tag ?? ''}
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
        />
        <span class="atm-hint">Leave it empty for the newest release.</span>
      </div>
      <div class="atm-editform__actions">
        <button class="atm-btn atm-btn--primary atm-btn--sm" disabled={locked}>review extension</button>
      </div>
    </form>
    <p class="atm-hint">Nothing is installed until you've reviewed what it will do and confirmed.</p>
  </div>
</div>

<div class="atm-card extensions__installed">
  <div class="atm-card__header"><span>Installed</span></div>
  <div class="atm-card__body rows">
    {#each data.installs as install (install.id)}
      <div class="extensions__row">
        <div class="extensions__who">
          <a href="/admin/extensions/{install.id}"><strong>{install.name}</strong></a>
          <span class="extensions__meta">
            {install.tag ?? 'local project'} · version {install.version} · updated {relTime(install.updatedAt)}
          </span>
          <span class="extensions__meta"><code>{install.gitUrl}</code></span>
        </div>
        {#if install.state === 'disabled'}
          <span class="atm-chip atm-chip--warn">disabled</span>
        {:else}
          <span class="atm-chip atm-chip--ok">active</span>
        {/if}
      </div>
    {:else}
      <p class="atm-empty atm-empty--bare">No extensions yet.</p>
    {/each}
  </div>
</div>

{#if data.leftoverClaims.length}
  <div class="atm-card extensions__claims">
    <div class="atm-card__header"><span>Collections held by uninstalled extensions</span></div>
    <div class="atm-card__body rows">
      <p class="atm-hint extensions__note">
        When an extension is uninstalled, its records stay in the forum's account, and nothing from a different repository
        can write to those collections. Release a collection only if you want another extension to be able to take it
        over, including editing or replacing the records already there.
      </p>
      {#each data.leftoverClaims as claim (claim.collection)}
        <form class="extensions__claim" method="POST" action="?/releaseClaim">
          <div class="extensions__who">
            <code>{claim.collection}</code>
            <span class="extensions__meta">held by {claim.gitUrl} since {relTime(claim.claimedAt)}</span>
          </div>
          <input type="hidden" name="collection" value={claim.collection} />
          <label class="extensions__really">
            <input type="checkbox" name="really" required />
            Another extension could then claim this collection.
          </label>
          <button class="atm-btn atm-btn--ghost atm-btn--sm" disabled={locked}>release</button>
        </form>
      {/each}
    </div>
  </div>
{/if}

<style>
  .rows { display: grid; gap: var(--space-2); }
  .extensions__intro, .extensions__note { margin: 0 0 var(--space-4); max-width: 72ch; }
  .extensions__unavailable {
    background: var(--warn-bg);
    border: var(--border-hair) solid color-mix(in oklch, var(--warn-1) 40%, transparent);
    color: var(--forum-ink);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font: var(--type-ui);
    margin-bottom: var(--space-4);
    max-width: 72ch;
  }
  .extensions__errors p { margin: 0; }
  .extensions__errors ul { margin: var(--space-1) 0 0; padding-left: var(--space-5); }
  .extensions__add { max-width: 72ch; }
  .extensions__tag { max-width: 12rem; }
  .extensions__installed, .extensions__claims { margin-top: var(--space-5); }
  .extensions__row, .extensions__claim {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-2) 0;
  }
  .extensions__who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .extensions__meta { color: var(--forum-ink-soft); font: var(--type-meta); overflow-wrap: anywhere; }
  .extensions__really { font: var(--type-meta); display: flex; gap: 6px; align-items: center; color: var(--danger-1); }
</style>
