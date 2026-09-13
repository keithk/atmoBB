<script lang="ts">
  let { data, form } = $props();

  const customTopic = '__custom__';
  const recentTopicUris = new Set(data.recentThreads.map((thread) => thread.uri));
  let featuredEnabled = $state(data.homepage.featuredThreads.length > 0);
  let featuredChoices = $state(
    [0, 1, 2].map((index) => {
      const uri = data.homepage.featuredThreads[index] ?? '';
      return uri && !recentTopicUris.has(uri) ? customTopic : uri;
    }),
  );
  let customTopics = $state(
    [0, 1, 2].map((index) => {
      const uri = data.homepage.featuredThreads[index] ?? '';
      return uri && !recentTopicUris.has(uri) ? uri : '';
    }),
  );
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
      <div class="featured-settings">
        <label class="homepage-check">
          <input type="checkbox" name="featuredEnabled" bind:checked={featuredEnabled} />
          <span>
            <b>Show featured topics</b>
            <small>Highlight up to three topics above the homepage lists.</small>
          </span>
        </label>
        {#if featuredEnabled}
          <fieldset class="featured-fields">
            <legend class="atm-label">Topics (in order)</legend>
            {#each [0, 1, 2] as index}
              <div class="featured-field">
                <span class="featured-field__number" aria-hidden="true">{index + 1}</span>
                <label class="atm-field">
                  <span class="sr-only">Featured topic {index + 1}</span>
                  <select
                    class="atm-select"
                    name={featuredChoices[index] === customTopic ? undefined : 'featuredThread'}
                    bind:value={featuredChoices[index]}
                  >
                    <option value="">Choose a recent topic…</option>
                    {#each data.recentThreads as thread}
                      <option value={thread.uri}>{thread.title}{thread.boardName ? ` — ${thread.boardName}` : ''}</option>
                    {/each}
                    <option value={customTopic}>Paste a topic URL…</option>
                  </select>
                </label>
                {#if featuredChoices[index] === customTopic}
                  <label class="atm-field featured-url">
                    <span class="sr-only">Topic {index + 1} URL</span>
                    <input
                      class="atm-input"
                      name="featuredThread"
                      bind:value={customTopics[index]}
                      placeholder="https://forum.example/t/…"
                      required
                      autocapitalize="none"
                      autocorrect="off"
                      spellcheck="false"
                    />
                  </label>
                {/if}
              </div>
            {/each}
            <span class="atm-hint">Choose from the latest topics, or paste any topic’s URL.</span>
          </fieldset>
        {/if}
      </div>
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
  .featured-settings { display: grid; gap: var(--space-3); padding-top: var(--space-1); }
  .featured-fields { display: grid; gap: var(--space-2); padding: 0 0 0 var(--space-4); border: 0; }
  .featured-fields legend { margin-bottom: var(--space-1); }
  .featured-field { position: relative; display: grid; gap: var(--space-2); }
  .featured-field__number {
    position: absolute;
    z-index: 1;
    right: calc(100% + var(--space-2));
    top: var(--space-3);
    color: var(--forum-ink-faint);
    font: var(--type-meta);
  }
  .featured-url .atm-input { font-size: var(--text-sm); }
  @media (max-width: 640px) {
    .homepage-grid { grid-template-columns: 1fr; }
  }
</style>
