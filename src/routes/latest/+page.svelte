<script lang="ts">
  import TopicList from '$lib/components/TopicList.svelte';
  import { threadFilterHref } from '$lib/thread-filters';

  let { data } = $props();

  const filtered = $derived(!!(data.filters.q || data.filters.board || data.filters.tag));
</script>

<div class="atm-topic-filters">
  <form class="atm-topic-filters__form" method="GET">
    <label class="atm-topic-filters__search">
      <span class="atm-label">Search topic titles</span>
      <input class="atm-input" type="search" name="q" value={data.filters.q ?? ''} maxlength="200" placeholder="Search titles…" />
    </label>
    <label>
      <span class="atm-label">Board</span>
      <select class="atm-input" name="board" value={data.filters.board ?? ''}>
        <option value="">All boards</option>
        {#each data.boards as board}<option value={board.uri}>{board.name}</option>{/each}
      </select>
    </label>
    <label>
      <span class="atm-label">Tag</span>
      <input class="atm-input" name="tag" value={data.filters.tag ?? ''} maxlength="640" placeholder="Any tag" />
    </label>
    <button class="atm-btn atm-btn--primary">Filter</button>
    {#if filtered}<a class="atm-btn atm-btn--ghost" href="/latest">Clear</a>{/if}
  </form>
</div>

<TopicList
  threads={data.threads}
  handles={data.handles}
  accountDid={data.user?.did}
  forumDid={data.forumDid}
  showBoard
  sectionTitle={filtered ? 'Matching topics' : 'Latest activity'}
  emptyMessage={filtered ? 'No topics match these filters.' : 'No activity yet. Start the first thread.'}
/>

{#if data.cursor}
  <p class="atm-more"><a href={threadFilterHref(data.filters, data.cursor)}>older activity →</a></p>
{/if}
