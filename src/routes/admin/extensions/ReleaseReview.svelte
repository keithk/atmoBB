<script lang="ts">
  import type { ReviewView } from './extensions.server';

  let {
    review,
    confirmAction,
    discardAction,
    confirmLabel,
    disabled = false,
  }: { review: ReviewView; confirmAction: string; discardAction: string; confirmLabel: string; disabled?: boolean } = $props();

  const CAPABILITY_LABELS: Record<string, string> = {
    kv: 'Keep its own private storage on this server',
    records: "Publish, edit, and delete records in the forum's account, in the collections listed above",
    timers: 'Run on a schedule, even when nobody is visiting',
    notify: 'Send notifications to members who have turned them on',
  };

  const changes = $derived(review.changes);
  const changed = $derived(
    !!changes &&
      (changes.addedCollections.length > 0 ||
        changes.removedCollections.length > 0 ||
        changes.addedCapabilities.length > 0 ||
        changes.removedCapabilities.length > 0 ||
        !!changes.hostApi ||
        !!changes.dataVersion),
  );
</script>

<article class="atm-card review" aria-labelledby="review-{review.stagingId}">
  <div class="atm-card__header">
    <span id="review-{review.stagingId}">Review {review.name} {review.version}</span>
  </div>
  <div class="atm-card__body review__body">
    <div class="review__mark">
      {#if review.unverified}
        <p class="review__unverified">
          <strong>Unverified extension.</strong> The atmobb.app directory hasn't endorsed this repository. You can still
          install it. Only do so if you trust the people who publish it.
        </p>
      {:else if review.endorsement && !review.endorsement.shaReviewed}
        <p class="review__caution">
          <strong>Endorsed repository.</strong> The atmobb.app directory endorses this repository but hasn't reviewed this
          exact release.
        </p>
      {:else}
        <p class="atm-ok">
          <strong>Trusted.</strong> The atmobb.app directory endorses this repository and reviewed this exact release.
        </p>
      {/if}
    </div>

    <dl class="review__facts">
      <dt>Repository</dt>
      <dd><code>{review.gitUrl}</code></dd>
      <dt>Release</dt>
      <dd>{review.tag ?? 'local project'} · <code>{review.sha.slice(0, 12)}</code></dd>
      <dt>Needs</dt>
      <dd>atmoBB extension API {review.hostApi}</dd>
    </dl>

    {#if changes}
      <section class="review__section">
        <h3 class="review__heading">What changes from {changes.version.from}</h3>
        {#if changed}
          <ul class="review__list">
            {#each changes.addedCollections as collection (collection)}
              <li>Starts publishing <code>{collection}</code>. You'll reconnect the forum account after updating.</li>
            {/each}
            {#each changes.removedCollections as collection (collection)}
              <li>Stops publishing <code>{collection}</code>. Records it already published stay in the forum's account.</li>
            {/each}
            {#each changes.addedCapabilities as capability (capability)}
              <li>Gains: {CAPABILITY_LABELS[capability] ?? capability}</li>
            {/each}
            {#each changes.removedCapabilities as capability (capability)}
              <li>No longer: {CAPABILITY_LABELS[capability] ?? capability}</li>
            {/each}
            {#if changes.hostApi}
              <li>Needs extension API {changes.hostApi.to} instead of {changes.hostApi.from}.</li>
            {/if}
            {#if changes.dataVersion}
              <li>
                Converts its stored data from version {changes.dataVersion.from} to {changes.dataVersion.to}. If the conversion
                fails, {changes.version.from} stays active. Once it succeeds, earlier releases can't be rolled back to.
              </li>
            {/if}
          </ul>
        {:else}
          <p class="review__plain">Nothing it publishes, can do, or needs changes.</p>
        {/if}
      </section>
    {/if}

    <section class="review__section">
      <h3 class="review__heading">Records it publishes in the forum's account</h3>
      {#if review.collections.length}
        <p class="review__plain">
          Every collection is under <strong class="review__authority">{review.authority}</strong>, the domain that names and
          describes these records.
        </p>
        <ul class="review__list">
          {#each review.collections as collection (collection)}<li><code>{collection}</code></li>{/each}
        </ul>
        {#if review.lexicons?.status === 'verified'}
          <p class="atm-ok review__lexicons">
            Verified: these record formats match the ones {review.authority} publishes.
          </p>
        {:else if review.lexicons?.status === 'unpublished' && review.lexicons.warning}
          <p class="review__caution review__lexicons">{review.lexicons.warning}</p>
        {:else if review.lexicons?.status === 'unpublished'}
          <p class="review__caution review__lexicons">
            Unpublished: {review.authority} doesn't publish formats for {review.lexicons.missing.join(', ')}, so the ones this
            extension ships can't be checked against the owner's.
          </p>
        {/if}
        <p class="atm-hint">Records it publishes stay in the forum's account even if you uninstall it.</p>
      {:else}
        <p class="review__plain">None. It won't write anything to the forum's account.</p>
      {/if}
    </section>

    <section class="review__section">
      <h3 class="review__heading">What it can do</h3>
      {#if review.capabilities.length}
        <ul class="review__list">
          {#each review.capabilities as capability (capability)}<li>{CAPABILITY_LABELS[capability] ?? capability}</li>{/each}
        </ul>
      {:else}
        <p class="review__plain">Nothing beyond answering the people who use it.</p>
      {/if}
    </section>

    <section class="review__section">
      <h3 class="review__heading">What it can see</h3>
      <p class="review__plain">
        The account (DID) of every signed-in member who opens a thread it's attached to, and whether they're a member, staff,
        or banned here.
      </p>
    </section>

    <div class="review__actions">
      <form method="POST" action={confirmAction}>
        <input type="hidden" name="stagingId" value={review.stagingId} />
        <button class="atm-btn atm-btn--primary atm-btn--sm" {disabled}>{confirmLabel}</button>
      </form>
      <form method="POST" action={discardAction}>
        <input type="hidden" name="stagingId" value={review.stagingId} />
        <button class="atm-btn atm-btn--ghost atm-btn--sm" {disabled}>cancel</button>
      </form>
    </div>
  </div>
</article>

<style>
  .review { max-width: 72ch; margin-bottom: var(--space-5); }
  .review__body { display: grid; gap: var(--space-4); }
  .review__mark p { margin: 0; }
  .review__unverified,
  .review__caution {
    padding: var(--space-2) var(--space-3);
    background: var(--warn-bg);
    border: var(--border-hair) solid color-mix(in oklch, var(--warn-1) 40%, transparent);
    border-radius: var(--radius-md);
    color: var(--forum-ink);
    font: var(--type-ui);
  }
  .review__facts { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-3); margin: 0; font: var(--type-ui); }
  .review__facts dt { color: var(--forum-ink-soft); }
  .review__facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .review__section { display: grid; gap: var(--space-2); }
  .review__heading { margin: 0; font: var(--type-ui); font-weight: var(--w-semibold); color: var(--forum-ink); }
  .review__plain { margin: 0; font: var(--type-ui); }
  .review__list { margin: 0; padding-left: var(--space-5); font: var(--type-ui); display: grid; gap: var(--space-1); }
  .review__list code { overflow-wrap: anywhere; }
  .review__authority { font-family: var(--font-mono); }
  .review__lexicons { margin: 0; }
  .review__actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
</style>
