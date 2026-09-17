<script lang="ts">
  import { relTime } from '$lib/reltime';

  let { data, form } = $props();
</script>

<p class="atm-hint endorse__intro">
  Mark a repository trusted and the release SHAs you reviewed. Every install shows this on the install and update review,
  whether or not it's this forum.
</p>

{#if form?.saved}<p class="atm-ok">Saved. {form.saved} is endorsed.</p>{/if}
{#if form?.removed}<p class="atm-ok">Removed {form.removed.sha.slice(0, 12)} from {form.removed.gitUrl}.</p>{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card endorse__add">
  <div class="atm-card__header"><span>Endorse a release</span></div>
  <div class="atm-card__body">
    <form class="atm-editform" method="POST" action="?/endorse">
      <div class="atm-field">
        <label class="atm-label" for="endorse-git-url">Git URL</label>
        <input
          id="endorse-git-url"
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
      </div>
      <div class="atm-field">
        <label class="atm-label" for="endorse-sha">Release SHA reviewed</label>
        <input
          id="endorse-sha"
          class="atm-input"
          name="sha"
          placeholder="the commit SHA of the release you reviewed"
          value={form?.fields?.sha ?? ''}
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          required
        />
      </div>
      <div class="atm-field">
        <label class="atm-label" for="endorse-listing">Listing thread (optional)</label>
        <input
          id="endorse-listing"
          class="atm-input"
          name="listing"
          placeholder="at://did:.../app.atmobb.discussion.thread/..."
          value={form?.fields?.listing ?? ''}
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
        />
        <span class="atm-hint">The directory listing thread naming this extension's git URL.</span>
      </div>
      <div class="atm-editform__actions">
        <button class="atm-btn atm-btn--primary atm-btn--sm">endorse this release</button>
      </div>
    </form>
    <p class="atm-hint">
      Endorsing a repository for the first time adds it to the directory. Reviewing another release of the same repository
      adds that SHA alongside the ones already reviewed.
    </p>
  </div>
</div>

<div class="atm-card endorse__list">
  <div class="atm-card__header"><span>Endorsed repositories</span></div>
  <div class="atm-card__body rows">
    {#each data.endorsements as endorsement (endorsement.uri)}
      <div class="endorse__row">
        <div class="endorse__who">
          <code>{endorsement.gitUrl}</code>
          <span class="endorse__meta">
            updated {relTime(endorsement.updatedAt)}
            {#if endorsement.listing}· <a href={endorsement.listing}>listing thread</a>{/if}
          </span>
        </div>
        {#if endorsement.reviewed.length}
          <ul class="endorse__shas">
            {#each endorsement.reviewed as sha (sha)}
              <li>
                <code>{sha.slice(0, 12)}</code>
                <form method="POST" action="?/removeSha">
                  <input type="hidden" name="gitUrl" value={endorsement.gitUrl} />
                  <input type="hidden" name="sha" value={sha} />
                  <button class="atm-btn atm-btn--ghost atm-btn--sm" aria-label="Remove {sha} from reviewed releases">remove</button>
                </form>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="atm-hint">No reviewed SHAs left. The repository is still endorsed.</p>
        {/if}
      </div>
    {:else}
      <p class="atm-empty atm-empty--bare">No endorsed repositories yet.</p>
    {/each}
  </div>
</div>

<style>
  .rows { display: grid; gap: var(--space-3); }
  .endorse__intro { margin: 0 0 var(--space-4); max-width: 72ch; }
  .endorse__add { max-width: 72ch; }
  .endorse__list { margin-top: var(--space-5); }
  .endorse__row { display: grid; gap: var(--space-2); padding: var(--space-2) 0; border-top: var(--border-hair) solid var(--forum-line); }
  .endorse__row:first-child { border-top: none; padding-top: 0; }
  .endorse__who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .endorse__meta { color: var(--forum-ink-soft); font: var(--type-meta); overflow-wrap: anywhere; }
  .endorse__shas { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .endorse__shas li { display: flex; align-items: center; gap: var(--space-1); background: var(--forum-surface-2); border-radius: var(--radius-md); padding: 2px 4px 2px var(--space-2); }
</style>
