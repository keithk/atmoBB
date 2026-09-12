<script lang="ts">
  let { data, form } = $props();
</script>

{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card panel">
  <div class="atm-card__header"><span>Homepage</span></div>
  <div class="atm-card__body">
    <p class="lede">
      Choose what visitors see first. Featured topics are ordered independently from pinned topics;
      inaccessible or removed topics are safely skipped.
    </p>
    <form class="appearance" method="POST" action="?/saveHomepage">
      <div class="homepage-grid">
        <label class="atm-field">
          <span class="atm-label">Layout</span>
          <select class="atm-select" name="layout">
            <option value="boards" selected={data.homepage.layout === 'boards'}>Boards</option>
            <option value="latest" selected={data.homepage.layout === 'latest'}>Latest</option>
            <option value="categories-latest" selected={data.homepage.layout === 'categories-latest'}>Categories + Latest</option>
          </select>
          <span class="atm-hint">The default keeps the classic board index.</span>
        </label>
        <label class="atm-field">
          <span class="atm-label">Welcome panel</span>
          <select class="atm-select" name="welcome">
            <option value="classic" selected={data.homepage.welcome === 'classic'}>Classic</option>
            <option value="compact" selected={data.homepage.welcome === 'compact'}>Compact</option>
            <option value="hidden" selected={data.homepage.welcome === 'hidden'}>Hidden</option>
          </select>
          <span class="atm-hint">Shown only to visitors who are signed out.</span>
        </label>
      </div>
      <label class="homepage-check">
        <input type="checkbox" name="sidebar" checked={data.homepage.sidebar} />
        <span>
          <b>Show the forum sidebar</b>
          <small>Keep forum navigation and board links close at hand.</small>
        </span>
      </label>
      <fieldset class="featured-fields">
        <legend class="atm-label">Featured topics (optional, in order)</legend>
        {#each [0, 1, 2] as index}
          <label class="atm-field featured-field">
            <span class="featured-field__number">{index + 1}</span>
            <input
              class="atm-input"
              name="featuredThread"
              value={data.homepage.featuredThreads[index] ?? ''}
              list="recent-topics"
              placeholder="at://did:…/app.atmobb.discussion.thread/…"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
            />
          </label>
        {/each}
        <datalist id="recent-topics">
          {#each data.recentThreads as thread}
            <option value={thread.uri}>{thread.title}</option>
          {/each}
        </datalist>
        <span class="atm-hint">Paste a thread at-URI or choose a recent topic. Clear all three to hide the section.</span>
      </fieldset>
      <button class="atm-btn atm-btn--primary">save homepage</button>
    </form>
  </div>
</div>

<style>
  .panel { max-width: 80ch; margin-bottom: var(--space-4); }
  .lede { margin: 0 0 var(--space-4); font: var(--type-ui); color: var(--forum-ink-soft); }
  .appearance { display: grid; gap: var(--space-3); }
  .homepage-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
  .homepage-check { display: flex; align-items: flex-start; gap: var(--space-2); font: var(--type-ui); }
  .homepage-check input { margin-top: 3px; }
  .homepage-check span { display: grid; gap: 2px; }
  .homepage-check b { font-weight: var(--w-semibold); }
  .homepage-check small { color: var(--forum-ink-soft); }
  .featured-fields { display: grid; gap: var(--space-2); padding: 0; border: 0; }
  .featured-fields legend { margin-bottom: var(--space-1); }
  .featured-field { position: relative; }
  .featured-field__number {
    position: absolute;
    z-index: 1;
    left: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--forum-ink-faint);
    font: var(--type-meta);
  }
  .featured-field .atm-input { padding-left: var(--space-6); font-family: var(--font-mono); font-size: var(--text-xs); }
  @media (max-width: 640px) {
    .homepage-grid { grid-template-columns: 1fr; }
  }
</style>
