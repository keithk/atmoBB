<script lang="ts">
  import { threadPath } from '$lib/appview-paths';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { relTime } from '$lib/reltime';
  import Avatar from '$lib/components/Avatar.svelte';
  import MemberLink from '$lib/components/MemberLink.svelte';
  import RichTextEditor from '$lib/components/RichTextEditor.svelte';

  let { data, form } = $props();

  // New-thread submit in flight; the action redirects to the fresh thread on success.
  let posting = $state(false);

  const user = $derived(page.data.user);
  const staff = $derived(data.canModerate);
  const name = (t: { authorProfile?: { displayName?: string }; author: string }) =>
    t.authorProfile?.displayName ?? data.handles[t.author] ?? t.author.slice(8, 20);

  const totalThreads = $derived(data.board?.threadCount ?? 0);
  const totalPosts = $derived(totalThreads + (data.board?.replyCount ?? 0));
  const totalPages = $derived(Math.max(1, Math.ceil(totalThreads / data.limit)));
  const currentPage = $derived(Math.floor(data.offset / data.limit) + 1);
  const basePath = $derived(data.basePath);
  const pageHref = (p: number) => (p <= 1 ? basePath : `${basePath}?cursor=${(p - 1) * data.limit}`);

  const pageList = $derived.by(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const keep = new Set(
      [1, totalPages, currentPage - 1, currentPage, currentPage + 1].filter((p) => p >= 1 && p <= totalPages),
    );
    return [...keep].sort((a, b) => a - b);
  });
</script>

<nav class="atm-crumbs">
  <a href="/">{data.forum.name}</a><span class="atm-crumbs__sep">›</span>
  <span class="atm-crumbs__current">{data.board?.name}</span>
</nav>

<div class="head">
  <div>
    <h1 class="head__title">
      {data.board?.name}
      {#if data.private}
        <span class="atm-chip" title="members-only board">🔒 members-only</span>
      {/if}
      {#if data.board?.topic}
        <span class="atm-chip atm-chip--topic">⁂ {data.board.topic}</span>
      {/if}
    </h1>
    <p class="head__desc">
      {#if data.board?.description}{data.board.description} &middot;{/if}
      <b>{totalThreads.toLocaleString()}</b> threads &middot; <b>{totalPosts.toLocaleString()}</b> posts
    </p>
  </div>
  {#if user && !data.locked}
    <a class="atm-btn atm-btn--primary" href="#composer">✎ new thread</a>
  {/if}
</div>

{#if data.locked}
  <div class="atm-card locked">
    <div class="atm-card__body locked__body">
      <div class="locked__icon" aria-hidden="true">🔒</div>
      <h2 class="locked__title">This board is members-only</h2>
      {#if !user}
        <p class="locked__msg">Only members can view this board's threads.</p>
        <a class="atm-btn atm-btn--primary" href="/login">Log in to request access</a>
      {:else if page.url.searchParams.has('requested')}
        <p class="locked__msg">Request received. A moderator will review it.</p>
      {:else}
        {#if form?.message}<p class="atm-err">{form.message}</p>{/if}
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
<div class="atm-panel">
  <div class="atm-board-section">Threads</div>
  {#each data.threads as t}
    <article class="atm-threadrow" class:atm-threadrow--pinned={t.pinned}>
      <span class="atm-threadrow__flag" aria-hidden="true">{t.pinned ? '📌' : t.locked ? '🔒' : '›'}</span>
      <div>
        <div class="atm-threadrow__title"><a href={threadPath(t.uri)}>{t.title}</a></div>
        <div class="atm-threadrow__sub">
          <span>by <MemberLink did={t.author}>{name(t)}</MemberLink></span>
          {#if t.origin}
            <span>&middot; via <span class="atm-via">{t.origin.name ?? t.origin.did.slice(8, 24)}</span></span>
          {/if}
          <span>&middot; started {relTime(t.createdAt)}</span>
          {#if staff}
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
          {/if}
        </div>
      </div>
      <div class="atm-threadrow__nums"><b>{t.replyCount}</b> {t.replyCount === 1 ? 'reply' : 'replies'}</div>
      <div class="atm-threadrow__last">
        <Avatar
          seed={t.lastReplyBy ?? t.author}
          profile={t.lastReplyBy && t.lastReplyBy !== t.author ? undefined : t.authorProfile}
          size={40}
        />
        <span>{relTime(t.lastActivity)}</span>
      </div>
    </article>
  {:else}
    <p class="atm-empty">No threads yet. Start the first one.</p>
  {/each}
</div>

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

{#if user}
  <div class="atm-card atm-composer" id="composer">
    <div class="atm-card__header">
      <span>Start a new thread</span>
      <span class="atm-composer__identity">posting as @{user.handle}</span>
    </div>
    <div class="atm-card__body">
      {#if form?.message}<p class="atm-err">{form.message}</p>{/if}
      <form
        class="atm-composer__form"
        method="POST"
        action="?/newThread"
        use:enhance={() => {
          posting = true;
          return async ({ update }) => {
            await update();
            posting = false;
          };
        }}
      >
        <div class="atm-field">
          <span class="atm-label">Title</span>
          <input class="atm-input" name="title" maxlength="300" required placeholder="Give your thread a title" />
        </div>
        <div class="atm-field">
          <span class="atm-label">Body</span>
          <RichTextEditor name="body" placeholder="Write your post…" allowImages={!data.private} />
        </div>
        {#if !data.private}
          <details class="atm-pollfields">
            <summary class="atm-label">Add a poll</summary>
            <div class="atm-pollfields__body">
              <input class="atm-input" name="pollQuestion" maxlength="300" placeholder="Question (optional; the title works too)" />
              <textarea class="atm-input" name="pollOptions" rows="4" placeholder="One option per line, 2 to 10"></textarea>
              <label class="atm-pollfields__row"><input type="checkbox" name="pollMultiple" value="1" /> Voters can pick more than one</label>
              <label class="atm-pollfields__row">Runs for <input class="atm-input atm-pollfields__days" type="number" name="pollDays" min="0" max="365" placeholder="∞" /> days</label>
            </div>
          </details>
        {/if}
        <button class="atm-btn atm-btn--primary" disabled={posting}>
          {#if posting}<span class="atm-spinner" aria-hidden="true"></span> Posting…{:else}✎ post thread{/if}
        </button>
      </form>
    </div>
  </div>
{:else}
  <p class="atm-loginhint"><a href="/login">Log in</a> to start a thread.</p>
{/if}
{/if}

<style>
  @layer atmobb {
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-4);
    margin: var(--space-4) 0;
    flex-wrap: wrap;
  }
  .head__title { font: var(--type-page-title); color: var(--forum-ink); margin: 0; }
  .head__desc { font: var(--type-meta); color: var(--forum-ink-soft); margin: 5px 0 0; }
  .head__desc b { color: var(--forum-ink); }

  .locked { margin-top: var(--space-4); }
  .locked__body { text-align: center; display: grid; justify-items: center; gap: var(--space-3); padding: var(--space-8) var(--space-4); }
  .locked__icon { font-size: 2rem; }
  .locked__title { font: var(--type-thread-title); color: var(--forum-ink); margin: 0; }
  .locked__msg { font: var(--type-ui); color: var(--forum-ink-soft); margin: 0; max-width: 46ch; }
  .locked__form { display: grid; gap: var(--space-3); width: min(46ch, 100%); }
  .locked__form textarea { resize: vertical; }
  }
</style>
