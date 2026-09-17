<script lang="ts">
  import { relTime } from '$lib/reltime';
  import ReconnectStep from '../ReconnectStep.svelte';
  import ReleaseReview from '../ReleaseReview.svelte';

  let { data, form } = $props();

  const install = $derived(data.install);
  const locked = $derived(!!data.unavailable);
  const reconnect = $derived(form?.reconnect ?? data.reconnect);
  const short = (sha: string) => sha.slice(0, 12);
  // Disable and uninstall need an explicit force when the extension says it's busy or can't be asked.
  const needsForce = $derived(
    !!form?.openWork || (!!data.openWork && ('error' in data.openWork || data.openWork.busy)),
  );
</script>

<p class="extensions__crumbs"><a href="/admin/extensions">← All extensions</a></p>

<div class="extensions__head">
  <h2 class="extensions__title">{install.name}</h2>
  {#if install.state === 'disabled'}
    <span class="atm-chip atm-chip--warn">disabled</span>
  {:else}
    <span class="atm-chip atm-chip--ok">active</span>
  {/if}
</div>

{#if data.unavailable}<p class="extensions__unavailable">{data.unavailable}</p>{/if}

{#if form?.updated}
  <p class="atm-ok">Updated to {form.updated.tag ?? 'the local project'} (version {form.updated.version}).</p>
{/if}
{#if form?.rolledBack}
  <p class="atm-ok">Rolled back to {form.rolledBack.tag ?? 'the earlier release'} (version {form.rolledBack.version}).</p>
{/if}
{#if form?.disabled}<p class="atm-ok">Disabled. It won't run until you enable it again.</p>{/if}
{#if form?.enabled}<p class="atm-ok">Enabled.</p>{/if}
{#if form?.discarded}<p class="atm-ok">Cancelled. The installed release didn't change.</p>{/if}
{#if form?.released}<p class="atm-ok">Released {form.released}. Any extension can now claim it.</p>{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}
{#if form?.errors?.length}
  <div class="atm-err extensions__errors" role="alert">
    <ul>
      {#each form.errors as problem, i (i)}<li>{problem.message}</li>{/each}
    </ul>
  </div>
{/if}

{#if reconnect.needed}<ReconnectStep {reconnect} />{/if}

{#if form?.review}
  <ReleaseReview
    review={form.review}
    confirmAction="?/applyUpdate"
    discardAction="?/discardUpdate"
    confirmLabel="update to {form.review.tag ?? 'this build'}"
    disabled={locked}
  />
{/if}

<div class="atm-card extensions__card">
  <div class="atm-card__header"><span>Installed release</span></div>
  <div class="atm-card__body">
    <dl class="extensions__facts">
      <dt>Release</dt>
      <dd>{install.tag ?? 'local project'} · version {install.version} · <code>{short(install.sha)}</code></dd>
      <dt>Repository</dt>
      <dd><code>{install.gitUrl}</code></dd>
      <dt>Publishes</dt>
      <dd>
        {#each install.collections as collection, i (collection)}{i ? ', ' : ''}<code>{collection}</code>{:else}nothing{/each}
      </dd>
      <dt>Can use</dt>
      <dd>{install.capabilities.join(', ') || 'nothing extra'}</dd>
      <dt>Installed</dt>
      <dd>{relTime(install.installedAt)}, last changed {relTime(install.updatedAt)}</dd>
    </dl>
  </div>
</div>

<div class="atm-card extensions__card">
  <div class="atm-card__header"><span>Updates</span></div>
  <div class="atm-card__body rows">
    <p class="atm-hint extensions__note">
      This extension stays on its installed release until you pick an update. You'll review what changes before it
      goes live.
    </p>
    {#if install.source === 'dev'}
      <form method="POST" action="?/stageUpdate">
        <button class="atm-btn atm-btn--primary atm-btn--sm" disabled={locked}>re-read the local project</button>
      </form>
    {:else if 'error' in data.updates}
      <p class="atm-err">Couldn't check for updates: {data.updates.error}</p>
    {:else}
      {#each data.updates.newer as tag (tag.name)}
        <form class="extensions__row" method="POST" action="?/stageUpdate">
          <span><strong>{tag.name}</strong> <code class="extensions__meta">{short(tag.sha)}</code></span>
          <input type="hidden" name="tag" value={tag.name} />
          <button class="atm-btn atm-btn--primary atm-btn--sm" disabled={locked}>review update</button>
        </form>
      {:else}
        <p class="atm-empty atm-empty--bare">No newer releases.</p>
      {/each}
      {#each data.updates.changed as tag (tag.tag)}
        <form class="extensions__row" method="POST" action="?/stageUpdate">
          <span class="extensions__who">
            <strong>{tag.tag} was changed</strong>
            <span class="extensions__meta">
              It pointed at <code>{short(tag.installedSha)}</code> when installed and now points at
              <code>{short(tag.currentSha)}</code>. Releases shouldn't change after they're published, so check with
              whoever publishes it before using this.
            </span>
          </span>
          <input type="hidden" name="tag" value={tag.tag} />
          <button class="atm-btn atm-btn--ghost atm-btn--sm" disabled={locked}>review changed release</button>
        </form>
      {/each}
    {/if}

    {#if data.history.length}
      <h3 class="extensions__subhead">Earlier releases</h3>
      {#each data.history as release (release.sha)}
        <form class="extensions__row" method="POST" action="?/rollback">
          <span class="extensions__who">
            <span>{release.tag ?? 'local project'} · version {release.version} · <code>{short(release.sha)}</code></span>
            <span class="extensions__meta">
              installed {relTime(release.installedAt)}
              {#if !release.canRollBack}· stores data in an older format, so it can't be rolled back to{/if}
            </span>
          </span>
          <input type="hidden" name="sha" value={release.sha} />
          <button class="atm-btn atm-btn--ghost atm-btn--sm" disabled={locked || !release.canRollBack}>roll back</button>
        </form>
      {/each}
    {/if}
  </div>
</div>

<div class="atm-card extensions__card">
  <div class="atm-card__header"><span>Disable or uninstall</span></div>
  <div class="atm-card__body rows">
    {#if data.openWork && 'error' in data.openWork}
      <p class="extensions__caution">
        Couldn't ask {install.name} whether anything is in progress: {data.openWork.error}
      </p>
    {:else if data.openWork?.busy}
      <p class="extensions__caution">
        {install.name} reports work in progress, like a game that hasn't finished. Stopping it now leaves that work where
        it is.
      </p>
    {:else if data.openWork}
      <p class="atm-hint extensions__note">{install.name} reports nothing in progress.</p>
    {/if}
    <p class="atm-hint extensions__note">
      Either way, records it already published stay in the forum's account. Uninstalling removes its files; its private
      storage is kept for a grace period and then deleted.
    </p>

    {#if install.state === 'disabled'}
      <form method="POST" action="?/enable">
        <button class="atm-btn atm-btn--primary atm-btn--sm" disabled={locked}>enable</button>
      </form>
    {:else}
      <form class="extensions__stop" method="POST" action="?/disable">
        {#if needsForce}
          <label class="extensions__really">
            <input type="checkbox" name="force" required />
            Disable it anyway, with work in progress.
          </label>
        {/if}
        <button class="atm-btn atm-btn--ghost atm-btn--sm" disabled={locked}>disable</button>
      </form>
    {/if}
    <form class="extensions__stop" method="POST" action="?/uninstall">
      {#if needsForce}
        <label class="extensions__really">
          <input type="checkbox" name="force" required />
          Uninstall it anyway, with work in progress.
        </label>
      {/if}
      <button class="atm-btn atm-btn--ghost atm-btn--sm extensions__danger" disabled={locked}>uninstall</button>
    </form>
  </div>
</div>

{#if data.claims.length}
  <div class="atm-card extensions__card">
    <div class="atm-card__header"><span>Collections this repository holds</span></div>
    <div class="atm-card__body rows">
      <p class="atm-hint extensions__note">
        No extension from a different repository can write to these, even after this one is uninstalled. A collection an
        earlier release used can be released; any extension could then claim it, including editing or replacing the
        records already there.
      </p>
      {#each data.claims as claim (claim.collection)}
        <form class="extensions__row" method="POST" action="?/releaseClaim">
          <span class="extensions__who">
            <code>{claim.collection}</code>
            <span class="extensions__meta">
              claimed {relTime(claim.claimedAt)}{#if claim.declared} · the installed release uses it{/if}
            </span>
          </span>
          {#if !claim.declared}
            <input type="hidden" name="collection" value={claim.collection} />
            <label class="extensions__really">
              <input type="checkbox" name="really" required />
              Another extension could then claim this collection.
            </label>
            <button class="atm-btn atm-btn--ghost atm-btn--sm" disabled={locked}>release</button>
          {/if}
        </form>
      {/each}
    </div>
  </div>
{/if}

<details class="extensions__log" open={data.log.some((line) => line.level === 'error')}>
  <summary>Extension log ({data.log.length} recent {data.log.length === 1 ? 'line' : 'lines'})</summary>
  {#if data.log.length}
    <pre>{data.log.map((line) => `${line.at}  ${line.level.padEnd(5)}  ${line.text}`).join('\n')}</pre>
  {:else}
    <p class="atm-hint">Nothing logged since the forum last started.</p>
  {/if}
</details>

<style>
  .rows { display: grid; gap: var(--space-2); }
  .extensions__crumbs { margin: 0 0 var(--space-2); font: var(--type-meta); }
  .extensions__head { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-4); }
  .extensions__title { margin: 0; font: var(--type-ui); font-size: var(--text-lg); font-weight: var(--w-semibold); color: var(--forum-ink); }
  .extensions__unavailable,
  .extensions__caution {
    background: var(--warn-bg);
    border: var(--border-hair) solid color-mix(in oklch, var(--warn-1) 40%, transparent);
    color: var(--forum-ink);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font: var(--type-ui);
    max-width: 72ch;
  }
  .extensions__unavailable { margin-bottom: var(--space-4); }
  .extensions__caution { margin: 0; }
  .extensions__errors ul { margin: 0; padding-left: var(--space-5); }
  .extensions__card { max-width: 72ch; margin-bottom: var(--space-5); }
  .extensions__note { margin: 0; max-width: 72ch; }
  .extensions__facts { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-3); margin: 0; font: var(--type-ui); }
  .extensions__facts dt { color: var(--forum-ink-soft); }
  .extensions__facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .extensions__subhead { margin: var(--space-3) 0 0; font: var(--type-ui); font-weight: var(--w-semibold); }
  .extensions__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-2) 0;
    border-top: var(--border-hair) solid var(--forum-line);
  }
  .extensions__who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .extensions__meta { color: var(--forum-ink-soft); font: var(--type-meta); overflow-wrap: anywhere; }
  .extensions__stop { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .extensions__really { font: var(--type-meta); display: flex; gap: 6px; align-items: center; color: var(--danger-1); }
  .extensions__danger { color: var(--danger-1); }
  .extensions__log { max-width: 72ch; color: var(--forum-ink-soft); }
  .extensions__log summary { cursor: pointer; font: var(--type-ui); }
  .extensions__log pre { max-height: 18rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: var(--space-3); background: var(--forum-surface-1); border-radius: var(--radius-md); font: var(--type-meta); }
</style>
