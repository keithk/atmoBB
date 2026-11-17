<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import BoardLabel from '$lib/components/BoardLabel.svelte';
  import PageBar from '$lib/components/PageBar.svelte';
  import NewThread from '$lib/components/NewThread.svelte';
  import TopicList from '$lib/components/TopicList.svelte';
  import JoinNotice from '$lib/components/JoinNotice.svelte';
  import { threadFilterHref } from '$lib/thread-filters';
  import { canPost } from '$lib/membership';
  import type { BoardIndex } from '$lib/server/appview';
  import type { ComposeBoard } from '$lib/new-thread';

  let { data, form } = $props();

  const user = $derived(page.data.user);
  // On a gated forum, non-members read but see no write controls (R22).
  const mayPost = $derived(canPost(page.data.standing));
  const staff = $derived(data.canModerate);
  // This board, as the new-thread composer shows it; color and emoji come from the sidebar index.
  const composeBoard = $derived.by((): ComposeBoard => {
    const indexed = (page.data.sidebarBoards as BoardIndex['boards'] | undefined)?.find((b) => b.uri === data.boardUri)?.value;
    return {
      uri: data.boardUri,
      path: data.basePath,
      name: data.board?.name ?? indexed?.name ?? 'this board',
      color: indexed?.color,
      emoji: indexed?.emoji,
      private: !!data.private,
      group: '',
      child: false,
    };
  });
  const filtered = $derived(!!(data.filters.q || data.filters.tag));
  const boardThreads = $derived(data.board?.threadCount ?? 0);
  const totalPosts = $derived(boardThreads + (data.board?.replyCount ?? 0));
  const summary = $derived(
    [data.board?.description, `${boardThreads.toLocaleString()} threads`, `${totalPosts.toLocaleString()} posts`]
      .filter(Boolean)
      .join(' · '),
  );
  const filteredThreads = $derived(data.filteredCount ?? boardThreads);
  const totalPages = $derived(Math.max(1, Math.ceil(filteredThreads / data.limit)));
  const currentPage = $derived(Math.floor(data.offset / data.limit) + 1);
  const basePath = $derived(data.basePath);
  const pageHref = (p: number) =>
    `${basePath}${threadFilterHref(data.filters, p <= 1 ? undefined : String((p - 1) * data.limit))}`;

  const pageList = $derived.by(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const keep = new Set(
      [1, totalPages, currentPage - 1, currentPage, currentPage + 1].filter((p) => p >= 1 && p <= totalPages),
    );
    return [...keep].sort((a, b) => a - b);
  });
</script>

<PageBar description={summary}>
  {#snippet heading()}
    <BoardLabel uri={data.boardUri} name={data.board?.name} />
    {#if data.private}
      <span class="atm-chip" title="members-only board">🔒 members-only</span>
    {/if}
    {#if data.board?.topic}
      <span class="atm-chip atm-chip--topic">⁂ {data.board.topic}</span>
    {/if}
  {/snippet}
  {#if user}
    {#if data.watching !== null}
      <form method="POST" action={data.watching ? '?/unwatch' : '?/watch'} use:enhance>
        <button class="atm-btn atm-btn--secondary atm-btn--sm">{data.watching ? 'Unwatch' : 'Watch'}</button>
      </form>
    {/if}
    {#if !data.locked && mayPost}
      <NewThread boards={[composeBoard]} selected={data.boardUri} handle={user.handle} />
    {/if}
  {/if}
</PageBar>
{#if form?.watch && form.message}<p class="atm-err">{form.message}</p>{/if}

{#if data.locked}
  <div class="atm-card locked">
    <div class="atm-card__body locked__body">
      <div class="locked__icon" aria-hidden="true">🔒</div>
      <h2 class="locked__title">This board is members-only</h2>
      {#if !mayPost}
        <JoinNotice action="ask for access to this board" />
      {:else if !user}
        <p class="locked__msg">Only members can view this board's threads.</p>
        <a class="atm-btn atm-btn--primary" href="/login">Log in to request access</a>
      {:else if page.url.searchParams.has('requested')}
        <p class="locked__msg">Request received. A moderator will review it.</p>
      {:else}
        {#if form?.message && !form.watch}<p class="atm-err">{form.message}</p>{/if}
        {#if data.requested}
          <p class="locked__msg">You've asked for access before. If it was turned down or removed, you can ask again.</p>
        {:else}
          <p class="locked__msg">Tell the moderators why you'd like access.</p>
        {/if}
        <form class="locked__form" method="POST" action="?/requestAccess">
          <textarea class="atm-input" name="reason" maxlength="300" rows="2" placeholder="Add a note for the moderators (optional)"></textarea>
          <button class="atm-btn atm-btn--primary">{data.requested ? 'Ask again' : 'Request access'}</button>
        </form>
      {/if}
    </div>
  </div>
{:else}
<form class="atm-topic-filters__form atm-topic-filters__form--board" method="GET">
  <label class="atm-topic-filters__search">
    <span class="atm-label">Search topic titles</span>
    <input class="atm-input" type="search" name="q" value={data.filters.q ?? ''} maxlength="200" placeholder="Search titles…" />
  </label>
  <label>
    <span class="atm-label">Tag</span>
    <input class="atm-input" name="tag" value={data.filters.tag ?? ''} maxlength="640" placeholder="Any tag" />
  </label>
  <button class="atm-btn atm-btn--primary">Filter</button>
  {#if filtered}<a class="atm-btn atm-btn--ghost" href={basePath}>Clear</a>{/if}
</form>
<TopicList
  threads={data.threads}
  accountDid={user?.did}
  forumDid={data.forumDid}
  boardName={data.board?.name}
  tagHref={(tag) => `${basePath}?tag=${encodeURIComponent(tag)}`}
  actions={staff ? modActions : undefined}
  emptyMessage={filtered ? 'No topics match these filters.' : 'No threads yet. Start the first one.'}
/>

{#snippet modActions(t: (typeof data.threads)[number])}
  {#snippet modact(action: string, label: string, title: string)}
    <form class="atm-modact" method="POST" action="?/moderateThread">
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="uri" value={t.uri} />
      <input type="hidden" name="cid" value={t.cid ?? ''} />
      <button class="atm-linkbtn atm-modact__btn" {title}>{label}</button>
    </form>
  {/snippet}
  {@render modact('hide', 'hide', 'Hide this thread from this forum')}
  {#if t.origin}
    <form class="atm-modact" method="POST" action="?/blockForum">
      <input type="hidden" name="did" value={t.origin.did} />
      <button class="atm-linkbtn atm-modact__btn" title="Block {t.origin.name ?? t.origin.did} from this board">block forum</button>
    </form>
  {:else}
    {#if t.locked}
      {@render modact('unlock', 'unlock', 'Let members reply again')}
    {:else}
      {@render modact('lock', 'lock', 'Stop new replies')}
    {/if}
    {#if t.pinned}
      {@render modact('unpin', 'unpin', 'Let this thread sort by activity again')}
    {:else}
      {@render modact('pin', 'pin', 'Keep this thread at the top of the board')}
    {/if}
  {/if}
{/snippet}

{#if totalPages > 1}
  <div class="atm-pager-row">
    <div class="atm-pager">
      {#if currentPage > 1}
        <a class="atm-pager__btn" href={pageHref(currentPage - 1)}>‹</a>
      {:else}
        <span class="atm-pager__btn" aria-disabled="true">‹</span>
      {/if}
      {#each pageList as p, i}
        {#if i > 0 && p - pageList[i - 1] > 1}
          <span class="atm-pager__gap">…</span>
        {/if}
        <a
          class="atm-pager__btn {p === currentPage ? 'atm-pager__btn--active' : ''}"
          href={pageHref(p)}
          aria-current={p === currentPage ? 'page' : undefined}>{p}</a
        >
      {/each}
      {#if currentPage < totalPages}
        <a class="atm-pager__btn" href={pageHref(currentPage + 1)}>›</a>
      {:else}
        <span class="atm-pager__btn" aria-disabled="true">›</span>
      {/if}
    </div>
  </div>
{/if}

{#if !mayPost}
  <JoinNotice action="start a thread" />
{:else if !user}
  <p class="atm-loginhint"><a href="/login">Log in</a> to start a thread.</p>
{/if}
{/if}

<style>
  @layer atmobb {
  .locked { margin-top: var(--space-4); }
  .locked__body { text-align: center; display: grid; justify-items: center; gap: var(--space-3); padding: var(--space-8) var(--space-4); }
  .locked__icon { font-size: 2rem; }
  .locked__title { font: var(--type-thread-title); color: var(--forum-ink); margin: 0; }
  .locked__msg { font: var(--type-ui); color: var(--forum-ink-soft); margin: 0; max-width: 46ch; }
  .locked__form { display: grid; gap: var(--space-3); width: min(46ch, 100%); }
  .locked__form textarea { resize: vertical; }
  }
</style>
