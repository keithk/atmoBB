<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import PostMeta from '$lib/components/PostMeta.svelte';
  import RichText from '$lib/components/RichText.svelte';
  import RichTextEditor from '$lib/components/RichTextEditor.svelte';
  import { page } from '$app/state';
  import { postAnchor, postAuthor, postPath, replyPath } from '$lib/appview-paths';
  import PostEditor from '$lib/components/PostEditor.svelte';
  // Simplified sibling of /t/[did]/[rkey]: private threads live in a space, so
  // reads are immediate (no firehose lag) — no waiting/polling states needed.
  let { data, form } = $props();
  const user = $derived(page.data.user);
  const saved = $derived(page.url.searchParams.has('saved'));
  const deleted = $derived(page.url.searchParams.has('deleted'));
  const editHref = (uri: string) => `${page.url.pathname}?edit=${uri.split('/').pop()}#${postAnchor(uri)}`;
  const confirmDelete = (e: SubmitEvent) => {
    if (!confirm('Delete this post? This removes it from the board.')) e.preventDefault();
  };

  // Reply composer: submit in flight, and remounting the editor to clear it.
  let posting = $state(false);
  let composerKey = $state(0);
  // Answering a specific post (from ?to= / ?quote=); cleared once it's sent.
  let replyingTo = $state(data.replyTo);
  let composerDoc = $state(data.composerDoc);
  const respondHref = (uri: string, kind: 'to' | 'quote') => `${page.url.pathname}?${kind}=${uri.split('/').pop()}#reply`;
  const shortName = (did: string) => data.handles[did] ?? did.slice(8, 20);

  // A posted reply is readable at once; just re-run the load.
  $effect(() => {
    if (form?.posted) invalidateAll();
  });

  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '');
</script>

{#if data.thread}
  <nav class="atm-crumbs atm-crumbs--spaced">
    <a href="/">{data.forum.name}</a><span class="atm-crumbs__sep">›</span>
    <a href={data.boardPath}>{data.boardName ?? 'Board'}</a><span class="atm-crumbs__sep">›</span>
    <span class="atm-crumbs__current">{data.thread.value.title}</span>
    <span class="atm-chip" title="members-only board">🔒 members-only</span>
  </nav>

  {#if saved}
    <p class="atm-ok">Saved.</p>
  {:else if deleted}
    <p class="atm-ok">Deleted.</p>
  {/if}
  {#if form?.message && !form?.posted && !data.editing}<p class="atm-err">{form.message}</p>{/if}

  <article class="atm-card atm-card--edge atm-post atm-post--op" id={postAnchor(data.thread.uri)}>
    <PostMeta
      did={data.thread.author}
      handle={data.handles[data.thread.author]}
      profile={data.thread.authorProfile}
      presence={data.presence[data.thread.author]}
      ranks={data.ranks}
      posts={data.thread.authorPosts}
    />
    <div class="atm-post__body">
      <div class="atm-post__meta">
        <a class="atm-post__permalink" href="#{postAnchor(data.thread.uri)}">{when(data.thread.value.createdAt)}</a>
        {@render edited(data.thread.value.editedAt)}
        {@render own(data.thread.uri, data.thread.author)}
        {@render respond(data.thread.uri)}
      </div>
      {#if data.editing?.uri === data.thread.uri}
        <PostEditor uri={data.thread.uri} title={data.thread.value.title} doc={data.editing.doc} cancelHref="{page.url.pathname}#{postAnchor(data.thread.uri)}" message={form?.message} allowImages={false} />
      {:else}
        <RichText body={data.thread.value.body} threadUri={data.threadUri} handles={data.handles} />
      {/if}
      {#if data.thread.authorProfile?.signature}
        <div class="atm-sig"><RichText body={data.thread.authorProfile.signature} /></div>
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
          <PostEditor uri={reply.uri} doc={data.editing.doc} cancelHref="{page.url.pathname}#{postAnchor(reply.uri)}" message={form?.message} allowImages={false} />
        {:else}
          <RichText body={reply.value.body} threadUri={data.threadUri} handles={data.handles} />
        {/if}
        {#if reply.authorProfile?.signature}
          <div class="atm-sig"><RichText body={reply.authorProfile.signature} /></div>
        {/if}
      </div>
    </article>
  {/each}

  {#if user}
    <section class="atm-composer" id="reply">
      <h3 class="atm-composer__title">Reply</h3>
      {#if replyingTo}
        <p class="atm-composer__replyto">
          ↩ replying to <a href={postPath(data.threadUri, replyingTo.uri)}>@{shortName(replyingTo.author)}</a>
          <a class="atm-linkbtn" href="{page.url.pathname}#reply" title="Reply to the thread instead">×</a>
        </p>
      {/if}
      {#if form?.posted}<p class="atm-ok" aria-live="polite">Posted ✓</p>{/if}
      {#if form?.message}<p class="atm-err">{form.message}</p>{/if}
      <form
        method="POST"
        action="?/reply"
        use:enhance={() => {
          posting = true;
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
          <RichTextEditor name="body" placeholder="Add to the discussion…" initial={composerDoc ?? undefined} allowImages={false} />
        {/key}
        <button class="atm-btn atm-btn--primary atm-composer__submit" disabled={posting}>
          {#if posting}<span class="atm-spinner" aria-hidden="true"></span> Posting…{:else}↩ post reply{/if}
        </button>
      </form>
    </section>
  {:else}
    <p class="atm-loginhint"><a href="/login">Log in</a> to reply.</p>
  {/if}
{:else}
  <p class="atm-notice">Thread not found.</p>
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
