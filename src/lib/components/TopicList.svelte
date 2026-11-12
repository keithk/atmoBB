<script lang="ts" generics="Topic extends ThreadSummary & { pinned?: boolean; locked?: boolean }">
  import type { Snippet } from 'svelte';
  import { boardPath, threadPath } from '$lib/appview-paths';
  import type { ThreadSummary } from '$lib/server/appview';
  import { relTime } from '$lib/reltime';
  import Avatar from './Avatar.svelte';
  import MemberLink from './MemberLink.svelte';
  import TopicReadStatus from './TopicReadStatus.svelte';
  import BoardLabel from './BoardLabel.svelte';

  let {
    threads,
    accountDid,
    forumDid,
    showBoard = false,
    flush = false,
    emptyMessage = 'No topics found.',
    boardName,
    tagHref = (tag: string) => `/latest?tag=${encodeURIComponent(tag)}`,
    actions,
  }: {
    threads: Topic[];
    accountDid?: string | null;
    forumDid?: string;
    showBoard?: boolean;
    /** The list is the page's own content, not inside a framed panel: titles line up with the page edge. */
    flush?: boolean;
    emptyMessage?: string;
    /** Board name for thread links when the list is one board's and rows don't carry it. */
    boardName?: string;
    tagHref?: (tag: string) => string;
    /** Per-row controls, shown after the title. */
    actions?: Snippet<[Topic]>;
  } = $props();

  const href = (thread: Topic) => threadPath(thread.uri, thread.boardName ?? boardName, thread.title);
</script>

<div class="atm-topic-list" class:atm-topic-list--boards={showBoard} class:atm-topic-list--flush={flush}>
  {#each threads as thread}
    <article class="atm-threadrow atm-threadrow--compact" class:atm-threadrow--pinned={thread.pinned} class:atm-threadrow--locked={thread.locked}>
      <div class="atm-threadrow__status">
        {#if forumDid}
          <TopicReadStatus
            compact
            {accountDid}
            {forumDid}
            threadUri={thread.uri}
            canonicalHref={href(thread)}
            createdAt={thread.createdAt}
            lastActivity={thread.lastActivity}
            replyCount={thread.replyCount}
            lastPostBy={thread.replyCount === 0 ? thread.author : thread.lastReplyBy}
          />
        {/if}
      </div>
      <div class="atm-threadrow__main">
        <a class="atm-threadrow__title" href={href(thread)}>{thread.title}</a>
        {#if thread.pinned}<span class="atm-chip atm-threadrow__flag">pinned</span>{/if}
        {#if thread.locked}<span class="atm-chip atm-threadrow__flag">locked</span>{/if}
        {#if thread.tags?.length}
          <span class="atm-topic-tags" aria-label="Tags">
            {#each thread.tags as tag}
              <a class="atm-topic-tag" href={tagHref(tag)}>{tag}</a>
            {/each}
          </span>
        {/if}
        {#if thread.origin}
          <span class="atm-threadrow__via">via <span class="atm-via">{thread.origin.name ?? thread.origin.did.slice(8, 24)}</span></span>
        {/if}
        {#if actions}<span class="atm-threadrow__actions">{@render actions(thread)}</span>{/if}
      </div>
      <div class="atm-topic-participants" aria-label="Participants">
        {#each thread.participants?.length ? thread.participants : [{ did: thread.author, profile: thread.authorProfile }] as participant}
          <MemberLink did={participant.did}><Avatar seed={participant.did} profile={participant.profile} size={24} alt="" /></MemberLink>
        {/each}
      </div>
      {#if showBoard}
        <div class="atm-threadrow__board">
          {#if thread.boardName}<a href={boardPath(thread.board, forumDid ?? '')}><BoardLabel uri={thread.board} name={thread.boardName} /></a>{/if}
        </div>
      {/if}
      <div class="atm-threadrow__nums">{thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}</div>
      <time class="atm-threadrow__age" datetime={thread.lastActivity}>{relTime(thread.lastActivity)}</time>
    </article>
  {:else}
    <p class="atm-empty">{emptyMessage}</p>
  {/each}
</div>

<style>
  @layer atmobb {
    .atm-topic-list { container-type: inline-size; }
    .atm-topic-list > :last-child { border-bottom: none; }

    /* One line per topic: read dot, title, who's in it, where, how much, when. */
    .atm-threadrow--compact {
      position: relative;
      grid-template-columns: minmax(0, 1fr) auto 84px 96px;
      gap: var(--space-3);
      padding: 10px var(--space-4);
      box-shadow: none;
    }
    /* A list with no frame of its own lines its titles up with the page's
       content edge; the hover tint and read dot use the gutter. */
    .atm-topic-list--flush .atm-threadrow--compact {
      margin-inline: calc(-1 * var(--space-4));
      border-bottom: none;
    }
    /* The hairline stops at the content edge even though the hover tint doesn't. */
    .atm-topic-list--flush .atm-threadrow--compact:not(:last-child)::after {
      content: '';
      position: absolute;
      inset: auto var(--space-4) 0;
      border-bottom: var(--border-hair) solid var(--forum-line);
    }
    .atm-topic-list--boards .atm-threadrow--compact { grid-template-columns: minmax(0, 1fr) auto 180px 84px 96px; }
    /* The read dot sits in the row's left padding, so titles line up whether
       or not there is one. */
    .atm-threadrow__status { position: absolute; left: 4px; top: 50%; display: flex; transform: translateY(-50%); }
    .atm-threadrow__status :global(.atm-topic-read-status__dot) { background: var(--forum-accent); }
    .atm-threadrow__status :global(.atm-topic-read-status--read .atm-topic-read-status__dot) { opacity: 0; }
    /* The pinned and locked tints carry their own edge stripe. */
    .atm-threadrow--compact.atm-threadrow--pinned { box-shadow: inset 3px 0 0 var(--forum-pin-edge); }
    .atm-threadrow--compact.atm-threadrow--locked { box-shadow: inset 3px 0 0 var(--forum-lock-edge); }
    .atm-threadrow__main { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
    .atm-threadrow--compact .atm-threadrow__title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: var(--w-regular) var(--text-base)/1.35 var(--font-display);
      color: var(--forum-ink);
      text-decoration: none;
    }
    .atm-threadrow--compact .atm-threadrow__title:hover { color: var(--forum-link); }
    /* Weight carries read state: bold until you've caught up, quiet after. */
    .atm-threadrow--compact:has(:global(.atm-topic-read-status--new), :global(.atm-topic-read-status--unread)) .atm-threadrow__title { font-weight: var(--w-bold); }
    .atm-threadrow--compact:has(:global(.atm-topic-read-status--read)) .atm-threadrow__title { color: var(--forum-ink-soft); }
    .atm-threadrow--compact .atm-topic-tags { flex: none; flex-wrap: nowrap; margin-top: 0; }
    .atm-threadrow__flag { flex: none; }
    /* Row controls stay out of the way until the row is hovered or focused. */
    .atm-threadrow__actions { display: flex; flex: none; gap: var(--space-2); opacity: 0; }
    .atm-threadrow--compact:hover .atm-threadrow__actions,
    .atm-threadrow--compact:focus-within .atm-threadrow__actions { opacity: 1; }
    @media (hover: none) { .atm-threadrow__actions { opacity: 1; } }
    .atm-threadrow__via { flex: none; font: var(--type-meta); color: var(--forum-ink-faint); white-space: nowrap; }
    .atm-threadrow--compact .atm-topic-participants { padding-left: 6px; }
    .atm-threadrow--compact .atm-topic-participants :global(a) { display: flex; margin-left: -6px; transition: margin-left var(--dur) var(--ease); }
    /* The pile fans out when you point at a row, so you can see who's in it. */
    .atm-threadrow--compact:hover .atm-topic-participants :global(a) { margin-left: 2px; }
    @media (prefers-reduced-motion: reduce) { .atm-threadrow--compact .atm-topic-participants :global(a) { transition: none; } }
    .atm-threadrow--compact .atm-topic-participants :global(a:last-child) { margin-left: 0; }
    .atm-threadrow--compact .atm-topic-participants :global(.atm-avatar) { margin-left: 0; }
    .atm-threadrow__board { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-meta); }
    .atm-threadrow__board a { color: var(--forum-ink-soft); }
    .atm-threadrow__board a:hover { color: var(--forum-link); }
    .atm-threadrow--compact .atm-threadrow__nums,
    .atm-threadrow__age {
      font: var(--w-regular) var(--text-xs)/1.3 var(--font-mono);
      color: var(--forum-ink-faint);
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    @container (max-width: 820px) {
      .atm-threadrow--compact,
      .atm-topic-list--boards .atm-threadrow--compact { grid-template-columns: minmax(0, 1fr) 150px 96px; }
      .atm-topic-list:not(.atm-topic-list--boards) .atm-threadrow--compact { grid-template-columns: minmax(0, 1fr) 84px 96px; }
      .atm-threadrow--compact .atm-topic-participants,
      .atm-threadrow--compact .atm-topic-tags,
      .atm-topic-list--boards .atm-threadrow__nums { display: none; }
    }
    @container (max-width: 520px) {
      .atm-threadrow--compact,
      .atm-topic-list--boards .atm-threadrow--compact,
      .atm-topic-list:not(.atm-topic-list--boards) .atm-threadrow--compact { grid-template-columns: minmax(0, 1fr) auto; }
      .atm-threadrow__board, .atm-threadrow--compact .atm-threadrow__nums, .atm-threadrow__via { display: none; }
      .atm-threadrow__main { flex-wrap: wrap; }
      .atm-threadrow--compact .atm-threadrow__title { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
    }
  }
</style>
