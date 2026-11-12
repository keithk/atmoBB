<script lang="ts">
  import { boardPath, postAnchor, postAuthor, postPath, replyPath } from '$lib/appview-paths';
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import PageBar from '$lib/components/PageBar.svelte';
  import PostMeta from '$lib/components/PostMeta.svelte';
  import BoardLabel from '$lib/components/BoardLabel.svelte';
  import RichText from '$lib/components/RichText.svelte';
  import PostContent from '$lib/components/PostContent.svelte';
  import RichTextEditor from '$lib/components/RichTextEditor.svelte';
  import PostEditor from '$lib/components/PostEditor.svelte';
  import Poll from '$lib/components/Poll.svelte';
  import ConversationLogin from '$lib/components/ConversationLogin.svelte';
  import NotifyPrompt from '$lib/components/NotifyPrompt.svelte';
  import ThreadReadingTracker from '$lib/components/ThreadReadingTracker.svelte';
  import JoinNotice from '$lib/components/JoinNotice.svelte';
  import ExtensionPanel from '$lib/components/ExtensionPanel.svelte';
  import { blocksToDoc } from '$lib/richtext/blocks-tiptap';
  import type { RichTextBlock } from '$lib/richtext/bbcode';
  import { blocksToPlainText } from '$lib/richtext/plain';
  import { page } from '$app/state';
  import { canPost } from '$lib/membership';
  let { data, form } = $props();
  const user = $derived(page.data.user);
  // On a gated forum, non-members read but see no write controls (R22).
  const mayPost = $derived(canPost(page.data.standing));

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
  // Once a reply is under way the composer pins to the bottom of the window,
  // so the post being answered stays in view.
  let docked = $state(false);
  let composerEditor = $state<{ focus: () => void; insertContent: (content: import('@tiptap/core').JSONContent[]) => void }>();
  const startReply = (post: { uri: string; cid?: string; author: string; body?: RichTextBlock[] }, quote = false) => {
    if (!post.cid) return;
    replyingTo = { uri: post.uri, cid: post.cid, author: post.author };
    if (quote) {
      const doc = blocksToDoc([{
        $type: 'app.atmobb.richtext.block#quote',
        text: blocksToPlainText(post.body),
        subject: { uri: post.uri, cid: post.cid },
      }]);
      composerEditor?.insertContent([...(doc.content ?? []), { type: 'paragraph' }]);
    } else {
      composerEditor?.focus();
    }
    docked = true;
  };
  const openReply = (event: Event) => {
    event.preventDefault();
    docked = true;
    composerEditor?.focus();
  };
  let copied = $state('');
  const copyLink = async (uri: string, href: string) => {
    try {
      await navigator.clipboard.writeText(new URL(href, location.href).href);
      copied = uri;
      setTimeout(() => { if (copied === uri) copied = ''; }, 1500);
    } catch {
      // Clipboard access can be refused; the timestamp beside it is the same link.
    }
  };
  const clearReplyTo = () => {
    replyingTo = null;
    composerEditor?.focus();
  };
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
  const composerOpen = $derived(!!user && mayPost && (!data.thread?.locked || data.canModerate));
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
  {@const board = data.thread.value.board}
  <PageBar>
    {#snippet crumb()}
      <a href={boardPath(board, data.forumDid)}><BoardLabel uri={board} name={data.boardName} /></a>
    {/snippet}
    {#if composerOpen}<a class="atm-btn atm-btn--primary atm-btn--sm" href="#reply" onclick={openReply}>↩ reply</a>{/if}
  </PageBar>
  <header class="atm-thread-head">
    {#if data.thread.value.tags?.length}
      <div class="atm-topic-tags" aria-label="Tags">
        {#each data.thread.value.tags as tag}<a class="atm-topic-tag" href="/latest?tag={encodeURIComponent(tag)}">{tag}</a>{/each}
      </div>
    {/if}
    <h1 class="atm-thread-head__title">{data.thread.value.title}</h1>
    {#if data.thread.pinned || data.thread.locked}
      <div class="atm-thread-head__flags">
        {#if data.thread.pinned}<span class="atm-chip" title="pinned to the top of its board">📌 pinned</span>{/if}
        {#if data.thread.locked}<span class="atm-chip" title="no new replies">🔒 locked</span>{/if}
      </div>
    {/if}
  </header>

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
  {#if data.offerNotifications && (data.fresh || form?.posted)}
    <NotifyPrompt next={page.url.pathname} />
  {/if}
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

  {#if data.extension?.attach.length}
    <p class="atm-hint">
      Attach extension:
      {#each data.extension.attach as link, i}{#if i > 0}, {/if}<a href={link.href}>{link.name}</a>{/each}
    </p>
  {/if}

  {#if totalPages > 1}
    <div class="atm-pager-row">{@render pager()}</div>
  {/if}

  <article
    class="atm-post atm-post--op"
    id={postAnchor(data.thread.uri)}
    data-atm-post-position="0"
    data-atm-post-at={data.thread.value.createdAt ?? ''}
  >
    <PostMeta
      did={data.thread.author}
      handle={data.handles[data.thread.author]}
      profile={data.thread.authorProfile}
      presence={data.presence[data.thread.author]}
      stamps={data.thread.authorStamps}
      handles={data.handles}
    />
    <div class="atm-post__body">
      <div class="atm-post__meta">
        <a class="atm-post__permalink" href="#{postAnchor(data.thread.uri)}">{when(data.thread.value.createdAt)}</a>
        {@render edited(data.thread.value.editedAt)}
      </div>
      {@render tools(data.thread, `#${postAnchor(data.thread.uri)}`)}
      {#if data.editing?.uri === data.thread.uri}
        <PostEditor uri={data.thread.uri} title={data.thread.value.title} tags={data.editing.tags} doc={data.editing.doc} cancelHref="{basePath}#{postAnchor(data.thread.uri)}" message={form?.message} />
      {:else}
        <PostContent postUri={data.threadUri} body={data.thread.value.body} threadUri={data.threadUri} threadHref={data.threadPath} handles={data.handles} />
      {/if}
      {#if data.thread.value.poll}
        <div class="atm-post__poll">
          <Poll poll={data.thread.value.poll} result={data.poll} canVote={!!user && mayPost} loginHint={!user && mayPost} syncing={voteSyncing} />
        </div>
      {/if}
      {#if data.thread.authorProfile?.signature}
        <div class="atm-sig">
          <RichText body={data.thread.authorProfile.signature} />
        </div>
      {/if}
    </div>
  </article>

  {#if data.extension?.panel}
    <!-- Keyed so reloading the page's data never remounts the frame. -->
    {#key `${data.extension.panel.installId}:${data.threadUri}`}
      <ExtensionPanel {...data.extension.panel} mode="thread" thread={data.threadUri} signedIn={!!user} />
    {/key}
  {/if}

  {#each data.replies as reply, i}
    <article
      class="atm-post"
      id={postAnchor(reply.uri)}
      data-atm-post-position={data.offset + i + 1}
      data-atm-post-at={reply.value.createdAt ?? reply.indexedAt ?? ''}
    >
      <PostMeta
        did={reply.author}
        handle={data.handles[reply.author]}
        profile={reply.authorProfile}
        presence={data.presence[reply.author]}
        stamps={reply.authorStamps}
        handles={data.handles}
      />
      <div class="atm-post__body">
        <div class="atm-post__meta">
          <a class="atm-post__permalink" href={replyPath(data.threadUri, reply.uri, data.threadPath)}>{when(reply.value.createdAt ?? reply.indexedAt)}</a>
          {@render edited(reply.value.editedAt)}
          {#if reply.value.parent}
            <span class="atm-post__replyto">
              · <a href={postPath(data.threadUri, reply.value.parent.uri, data.threadPath)}>↩ replying to @{shortName(postAuthor(reply.value.parent.uri))}</a>
            </span>
          {/if}
        </div>
        {@render tools(reply, replyPath(data.threadUri, reply.uri, data.threadPath))}
        {#if data.editing?.uri === reply.uri}
          <PostEditor uri={reply.uri} doc={data.editing.doc} cancelHref="{basePath}{page.url.search.replace(/[?&]edit=[^&]*/, '')}#{postAnchor(reply.uri)}" message={form?.message} />
        {:else}
          <PostContent postUri={reply.uri} body={reply.value.body} threadUri={data.threadUri} threadHref={data.threadPath} handles={data.handles} />
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
    <section class="atm-composer atm-composer--reply" class:atm-composer--docked={docked} id="reply" aria-label="Reply" onfocusin={() => (docked = true)}>
      <div class="atm-composer__body">
        {#if data.thread.locked}
          <p class="atm-hint">This thread is locked. Staff can still add a closing word.</p>
        {/if}
        {#if replyingTo}
          <p class="atm-composer__replyto">
            <span>↩ replying to <a href={postPath(data.threadUri, replyingTo.uri, data.threadPath)}>@{shortName(replyingTo.author)}</a></span>
            <button type="button" class="atm-post__action" onclick={clearReplyTo} title="Reply to the thread instead" aria-label="Reply to the thread instead">×</button>
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
          class="atm-composer__form"
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
                docked = false;
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
            <RichTextEditor bind:this={composerEditor} name="body" placeholder="Add to the discussion…" initial={composerDoc ?? undefined} />
          {/key}
          <div class="atm-composer__actions">
            {#if user}<span class="atm-composer__identity">posting as @{user.handle}</span>{/if}
            {#if docked}
              <button type="button" class="atm-btn atm-btn--ghost atm-btn--sm" onclick={() => (docked = false)} title="Send the reply box back to the end of the thread">unpin</button>
            {/if}
            <button class="atm-btn atm-btn--primary atm-composer__submit" disabled={posting}>
              {#if posting}<span class="atm-spinner" aria-hidden="true"></span> Posting…{:else}↩ post reply{/if}
            </button>
          </div>
        </form>
      </div>
    </section>
  {:else if !mayPost}
    <JoinNotice action="reply" />
  {:else if !data.thread.locked}
    <ConversationLogin />
  {/if}
  {#key `${data.threadUri}:${data.offset}:${user?.did ?? ''}:${data.forumDid}:${data.replies.map((reply) => reply.uri).join(',')}`}
    <ThreadReadingTracker accountDid={user?.did} forumDid={data.forumDid} threadUri={data.threadUri} />
  {/key}
{/if}

{#snippet tools(post: { uri: string; cid?: string; author: string; value: { body?: RichTextBlock[] } }, href: string)}
  <div class="atm-post__tools" role="toolbar" aria-label="Post actions">
    {#if user && mayPost}
      <button type="button" class="atm-post__action" onclick={() => startReply({ ...post, body: post.value.body })} title="Answer this post">reply</button>
      <button type="button" class="atm-post__action" onclick={() => startReply({ ...post, body: post.value.body }, true)} title="Answer this post, quoting it">quote</button>
    {/if}
    <button type="button" class="atm-post__action" onclick={() => copyLink(post.uri, href)}>{copied === post.uri ? 'copied' : 'copy link'}</button>
    {#if user?.did === post.author && data.editing?.uri !== post.uri}
      <button type="button" class="atm-post__action" onclick={() => location.assign(editHref(post.uri))}>edit</button>
      <form method="POST" action="?/delete" onsubmit={confirmDelete}>
        <input type="hidden" name="uri" value={post.uri} />
        <button class="atm-post__action">delete</button>
      </form>
    {/if}
  </div>
{/snippet}

{#snippet edited(at?: string)}
  {#if at}<span class="atm-post__edited" title={when(at)}>· edited</span>{/if}
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

<style>
  @layer atmobb {
  /* Post actions wait in the corner until the post is hovered or focused. */
  :global(.atm-post__body) { position: relative; }
  .atm-post__tools {
    position: absolute;
    top: var(--space-3);
    right: 0;
    display: flex;
    gap: var(--space-1);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease);
  }
  .atm-post__tools form { display: contents; }
  :global(.atm-post):hover .atm-post__tools,
  :global(.atm-post):focus-within .atm-post__tools { opacity: 1; }
  @media (hover: none), (max-width: 720px) {
    .atm-post__tools { position: static; opacity: 1; flex-wrap: wrap; margin-bottom: var(--space-2); }
  }
  @media (prefers-reduced-motion: reduce) { .atm-post__tools { transition: none; } }

  /* Pinned, the reply box floats over the thread, so it needs its own surface. */
  .atm-composer--docked {
    position: sticky;
    bottom: 0;
    z-index: 6;
    max-height: min(70vh, 560px);
    overflow-y: auto;
    padding: var(--space-3) 0;
    background: var(--forum-surface);
    border-top: var(--border-hair) solid var(--forum-line-strong);
  }
  }
</style>
