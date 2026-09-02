<script lang="ts">
  import { boardPath, postAnchor, postAuthor, postPath, replyPath } from '$lib/appview-paths';
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import PostMeta from '$lib/components/PostMeta.svelte';
  import RichText from '$lib/components/RichText.svelte';
  import RichTextEditor from '$lib/components/RichTextEditor.svelte';
  import PostEditor from '$lib/components/PostEditor.svelte';
  import Poll from '$lib/components/Poll.svelte';
  import { page } from '$app/state';
  let { data, form } = $props();
  const user = $derived(page.data.user);

  const totalReplies = $derived(data.replyCount ?? 0);
  const totalPages = $derived(Math.max(1, Math.ceil(totalReplies / data.limit)));
  const currentPage = $derived(Math.floor(data.offset / data.limit) + 1);
  const basePath = $derived(page.url.pathname);
  const pageHref = (p: number) => (p <= 1 ? basePath : `${basePath}?cursor=${(p - 1) * data.limit}`);
  const pageList = $derived.by(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const keep = new Set(
      [1, totalPages, currentPage - 1, currentPage, currentPage + 1].filter((p) => p >= 1 && p <= totalPages),
    );
    return [...keep].sort((a, b) => a - b);
  });

  // While a fresh post syncs back through the network, quietly re-run the
  // load every couple of seconds until it appears (or we give up).
  let timedOut = $state(false);
  $effect(() => {
    if (!data.waiting) return;
    let tries = 0;
    const t = setInterval(() => {
      if (++tries > 15) {
        timedOut = true;
        clearInterval(t);
        return;
      }
      invalidateAll();
    }, 2000);
    return () => clearInterval(t);
  });

  // Reply composer: submit in flight, and remounting the editor to clear it.
  let posting = $state(false);
  let composerKey = $state(0);
  // Answering a specific post (from ?to= / ?quote=); cleared once it's sent.
  let replyingTo = $state(data.replyTo);
  let composerDoc = $state(data.composerDoc);
  const respondHref = (uri: string, kind: 'to' | 'quote') => `${basePath}?${kind}=${uri.split('/').pop()}#reply`;
  const shortName = (did: string) => data.handles[did] ?? did.slice(8, 20);

  // The reply count captured when the current post was sent — the new reply has
  // landed (and shows above) once the count climbs past it.
  let repliesBefore = $state(-1);
  const syncing = $derived(!!form?.posted && repliesBefore !== -1 && data.replyCount <= repliesBefore);

  // After posting a reply, poll briefly until it travels the network and shows up.
  $effect(() => {
    if (!form?.posted) return;
    if (repliesBefore === -1) repliesBefore = data.replyCount;
    if (data.replyCount > repliesBefore) return;
    const t = setInterval(() => invalidateAll(), 2000);
    const stop = setTimeout(() => clearInterval(t), 30000);
    return () => { clearInterval(t); clearTimeout(stop); };
  });

  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '');

  // After a vote, poll the index until the tally shows the options chosen.
  const sameOptions = (a: number[], b: number[]) => a.length === b.length && a.every((o) => b.includes(o));
  const voteSyncing = $derived(!!form?.voted && !sameOptions(form.options ?? [], data.poll?.viewerOptions ?? []));
  $effect(() => {
    if (!voteSyncing) return;
    const t = setInterval(() => invalidateAll(), 2000);
    const stop = setTimeout(() => clearInterval(t), 30000);
    return () => { clearInterval(t); clearTimeout(stop); };
  });

  const moderated = $derived(page.url.searchParams.has('moderated'));
  const saved = $derived(page.url.searchParams.has('saved'));
  const deleted = $derived(page.url.searchParams.has('deleted'));
  const pending = $derived(page.url.searchParams.has('pending'));
  const editHref = (uri: string) => `${basePath}${page.url.search ? page.url.search + '&' : '?'}edit=${uri.split('/').pop()}#${postAnchor(uri)}`;
  const confirmDelete = (e: SubmitEvent) => {
    if (!confirm('Delete this post? This removes it from your repo.')) e.preventDefault();
  };
  // Members can't reply to a locked thread; staff still can, for a closing word.
  const composerOpen = $derived(!!user && (!data.thread?.locked || data.canModerate));
</script>

{#if !data.thread}
  {#if data.waiting && !timedOut}
    <div class="atm-notice atm-notice--waiting">
      <p><strong>Posting your thread…</strong></p>
      <p>It'll show up here in a few seconds.</p>
    </div>
  {:else if data.fresh}
    <p class="atm-notice">
      Your thread is still syncing. Check the board again in a minute.
    </p>
  {:else}
    <p class="atm-notice">Thread not found. It may not have synced yet.</p>
  {/if}
{:else}
  <nav class="atm-crumbs atm-crumbs--spaced">
    <a href="/">{data.forum.name}</a><span class="atm-crumbs__sep">›</span>
    <a href={boardPath(data.thread.value.board, data.forumDid)}>{data.boardName ?? 'Board'}</a><span class="atm-crumbs__sep">›</span>
    <span class="atm-crumbs__current">{data.thread.value.title}</span>
    {#if data.thread.pinned}<span class="atm-chip" title="pinned to the top of its board">📌 pinned</span>{/if}
    {#if data.thread.locked}<span class="atm-chip" title="no new replies">🔒 locked</span>{/if}
  </nav>

  {#if data.thread.hidden}
    <p class="atm-notice">This thread is hidden. Only staff can see it.</p>
  {/if}
  {#if pending}
    <p class="atm-ok">Saved. The change is taking a few extra seconds to show up here.</p>
  {:else if moderated || saved}
    <p class="atm-ok">Saved.</p>
  {:else if deleted}
    <p class="atm-ok">Deleted.</p>
  {/if}
  {#if form?.message && !form?.posted && !data.editing}<p class="atm-err">{form.message}</p>{/if}
  {#if data.canModerate}
    <div class="atm-modbar">
      <span>staff:</span>
      {#snippet modact(action: string, label: string, title: string)}
        <form class="atm-modact" method="POST" action="?/moderate">
          <input type="hidden" name="action" value={action} />
          <button class="atm-linkbtn atm-modact__btn" {title}>{label}</button>
        </form>
      {/snippet}
      {#if data.thread.hidden}
        {@render modact('unhide', 'unhide', 'Show this thread again')}
      {:else}
        {@render modact('hide', 'hide', 'Hide this thread from this forum')}
      {/if}
      {#if !data.thread.origin}
        {#if data.thread.locked}
          {@render modact('unlock', 'unlock', 'Let members reply again')}
        {:else}
          {@render modact('lock', 'lock', 'Stop new replies')}
        {/if}
        {#if data.thread.pinned}
          {@render modact('unpin', 'unpin', 'Let this thread sort by activity again')}
        {:else}
          {@render modact('pin', 'pin', 'Keep this thread at the top of its board')}
        {/if}
      {/if}
    </div>
  {/if}

  {#if totalPages > 1}
    <div class="atm-pager-row">{@render pager()}</div>
  {/if}

  <article class="atm-card atm-card--edge atm-post atm-post--op" id={postAnchor(data.thread.uri)}>
    <PostMeta
      did={data.thread.author}
      handle={data.handles[data.thread.author]}
      profile={data.thread.authorProfile}
      presence={data.presence[data.thread.author]}
      ranks={data.ranks}
      posts={data.thread.authorPosts}
      totalPosts={data.thread.authorTotalPosts}
    />
    <div class="atm-post__body">
      <div class="atm-post__meta">
        <a class="atm-post__permalink" href="#{postAnchor(data.thread.uri)}">{when(data.thread.value.createdAt)}</a>
        {@render edited(data.thread.value.editedAt)}
        {@render own(data.thread.uri, data.thread.author)}
        {@render respond(data.thread.uri)}
      </div>
      {#if data.editing?.uri === data.thread.uri}
        <PostEditor uri={data.thread.uri} title={data.thread.value.title} doc={data.editing.doc} cancelHref="{basePath}#{postAnchor(data.thread.uri)}" message={form?.message} />
      {:else}
        <RichText body={data.thread.value.body} threadUri={data.threadUri} handles={data.handles} />
      {/if}
      {#if data.thread.value.poll}
        <div class="atm-post__poll">
          <Poll poll={data.thread.value.poll} result={data.poll} canVote={!!user} syncing={voteSyncing} />
        </div>
      {/if}
      {#if data.thread.authorProfile?.signature}
        <div class="atm-sig">
          <RichText body={data.thread.authorProfile.signature} />
        </div>
      {/if}
    </div>
  </article>

  {#each data.replies as reply}
    <article class="atm-card atm-card--edge atm-post" id={postAnchor(reply.uri)}>
      <PostMeta
        did={reply.author}
        handle={data.handles[reply.author]}
        profile={reply.authorProfile}
        presence={data.presence[reply.author]}
        ranks={data.ranks}
        posts={reply.authorPosts}
        totalPosts={reply.authorTotalPosts}
      />
      <div class="atm-post__body">
        <div class="atm-post__meta">
          <a class="atm-post__permalink" href={replyPath(data.threadUri, reply.uri)}>{when(reply.value.createdAt ?? reply.indexedAt)}</a>
          {@render edited(reply.value.editedAt)}
          {#if reply.value.parent}
            <span class="atm-post__replyto">
              · <a href={postPath(data.threadUri, reply.value.parent.uri)}>↩ replying to @{shortName(postAuthor(reply.value.parent.uri))}</a>
            </span>
          {/if}
          {@render own(reply.uri, reply.author)}
          {@render respond(reply.uri)}
        </div>
        {#if data.editing?.uri === reply.uri}
          <PostEditor uri={reply.uri} doc={data.editing.doc} cancelHref="{basePath}{page.url.search.replace(/[?&]edit=[^&]*/, '')}#{postAnchor(reply.uri)}" message={form?.message} />
        {:else}
          <RichText body={reply.value.body} threadUri={data.threadUri} handles={data.handles} />
        {/if}
        {#if reply.authorProfile?.signature}
          <div class="atm-sig">
            <RichText body={reply.authorProfile.signature} />
          </div>
        {/if}
      </div>
    </article>
  {/each}

  {#if totalPages > 1}
    <div class="atm-pager-row">{@render pager()}</div>
  {/if}

  {#if data.thread.locked && !composerOpen}
    <p class="atm-notice">🔒 This thread is locked. No new replies.</p>
  {:else if composerOpen}
    <section class="atm-composer" id="reply">
      <h3 class="atm-composer__title">Reply</h3>
      {#if data.thread.locked}
        <p class="atm-hint">This thread is locked. Staff can still add a closing word.</p>
      {/if}
      {#if replyingTo}
        <p class="atm-composer__replyto">
          ↩ replying to <a href={postPath(data.threadUri, replyingTo.uri)}>@{shortName(replyingTo.author)}</a>
          <a class="atm-linkbtn" href="{basePath}#reply" title="Reply to the thread instead">×</a>
        </p>
      {/if}
      {#if form?.posted}
        <p class="atm-ok" aria-live="polite">
          {#if syncing}<span class="atm-spinner" aria-hidden="true"></span> Posted. Waiting for it to appear…
          {:else}Posted ✓{/if}
        </p>
      {/if}
      {#if form?.message}<p class="atm-err">{form.message}</p>{/if}
      <form
        method="POST"
        action="?/reply"
        use:enhance={() => {
          posting = true;
          repliesBefore = data.replyCount;
          return async ({ result, update }) => {
            await update({ reset: false });
            posting = false;
            if (result.type === 'success') {
              composerKey++;
              replyingTo = null;
              composerDoc = null;
            }
          };
        }}
      >
        <input type="hidden" name="threadCid" value={data.thread.cid ?? ''} />
        <input type="hidden" name="parentUri" value={replyingTo?.uri ?? ''} />
        <input type="hidden" name="parentCid" value={replyingTo?.cid ?? ''} />
        {#key composerKey}
          <RichTextEditor name="body" placeholder="Add to the discussion…" initial={composerDoc ?? undefined} />
        {/key}
        <button class="atm-btn atm-btn--primary atm-composer__submit" disabled={posting}>
          {#if posting}<span class="atm-spinner" aria-hidden="true"></span> Posting…{:else}↩ post reply{/if}
        </button>
      </form>
    </section>
  {:else if !data.thread.locked}
    <p class="atm-loginhint"><a href="/login">Log in</a> to reply.</p>
  {/if}
{/if}

{#snippet respond(uri: string)}
  {#if user}
    <span class="atm-post__own">
      <a href={respondHref(uri, 'to')} title="Answer this post">reply</a>
      <a href={respondHref(uri, 'quote')} title="Answer this post, quoting it">quote</a>
    </span>
  {/if}
{/snippet}

{#snippet edited(at?: string)}
  {#if at}<span class="atm-post__edited" title={when(at)}>· edited</span>{/if}
{/snippet}

{#snippet own(uri: string, author: string)}
  {#if user?.did === author && data.editing?.uri !== uri}
    <span class="atm-post__own">
      <a href={editHref(uri)}>edit</a>
      <form method="POST" action="?/delete" onsubmit={confirmDelete}>
        <input type="hidden" name="uri" value={uri} />
        <button class="atm-linkbtn">delete</button>
      </form>
    </span>
  {/if}
{/snippet}

{#snippet pager()}
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
{/snippet}
