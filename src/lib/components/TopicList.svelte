<script lang="ts">
  import { boardPath, threadPath } from '$lib/appview-paths';
  import type { ThreadSummary } from '$lib/server/appview';
  import { relTime } from '$lib/reltime';
  import Avatar from './Avatar.svelte';
  import MemberLink from './MemberLink.svelte';
  import TopicReadStatus from './TopicReadStatus.svelte';
  import BoardLabel from './BoardLabel.svelte';

  let {
    threads,
    handles = {},
    accountDid,
    forumDid,
    showBoard = false,
    embedded = false,
    sectionTitle,
    emptyMessage = 'No topics found.',
  }: {
    threads: ThreadSummary[];
    handles?: Record<string, string>;
    accountDid?: string | null;
    forumDid?: string;
    showBoard?: boolean;
    embedded?: boolean;
    sectionTitle?: string;
    emptyMessage?: string;
  } = $props();

  const name = (thread: ThreadSummary) =>
    thread.authorProfile?.displayName ?? handles[thread.author] ?? thread.author.slice(8, 18);
</script>

<div class="atm-topic-list" class:atm-panel={!embedded}>
  {#if sectionTitle}<div class="atm-board-section">{sectionTitle}</div>{/if}
  {#each threads as thread}
    <article class="atm-threadrow">
      <div class="atm-threadrow__main">
        <div class="atm-threadrow__title"><a href={threadPath(thread.uri)}>{thread.title}</a></div>
        {#if thread.tags?.length}
          <div class="atm-topic-tags" aria-label="Tags">
            {#each thread.tags as tag}
              <a class="atm-topic-tag" href="/latest?tag={encodeURIComponent(tag)}">{tag}</a>
            {/each}
          </div>
        {/if}
        <div class="atm-threadrow__sub">
          <span>by <MemberLink did={thread.author}>{name(thread)}</MemberLink></span>
          {#if showBoard && thread.boardName}
            <span>in <a href={boardPath(thread.board, forumDid ?? '')}><BoardLabel uri={thread.board} name={thread.boardName} /></a></span>
          {/if}
          {#if thread.origin}
            <span>· via <span class="atm-via">{thread.origin.name ?? thread.origin.did.slice(8, 24)}</span></span>
          {/if}
          {#if forumDid}
            <TopicReadStatus
              {accountDid}
              {forumDid}
              threadUri={thread.uri}
              canonicalHref={threadPath(thread.uri)}
              createdAt={thread.createdAt}
              lastActivity={thread.lastActivity}
              replyCount={thread.replyCount}
              lastPostBy={thread.replyCount === 0 ? thread.author : thread.lastReplyBy}
            />
          {/if}
        </div>
      </div>
      <div class="atm-threadrow__nums"><b>{thread.replyCount}</b> {thread.replyCount === 1 ? 'reply' : 'replies'}</div>
      <div class="atm-threadrow__last">
        <div class="atm-topic-participants" aria-label="Participants">
          {#each thread.participants?.length ? thread.participants : [{ did: thread.author, profile: thread.authorProfile }] as participant}
            <Avatar seed={participant.did} profile={participant.profile} size={30} alt="" />
          {/each}
        </div>
        <span>{relTime(thread.lastActivity)}</span>
      </div>
    </article>
  {:else}
    <p class="atm-empty">{emptyMessage}</p>
  {/each}
</div>

<style>
  @layer atmobb {
    .atm-topic-list { container-type: inline-size; }
    .atm-topic-list > :last-child { border-bottom: none; }
    .atm-threadrow { grid-template-columns: minmax(0, 1fr) 70px 200px; }
    .atm-threadrow__main { min-width: 0; overflow-wrap: anywhere; }
    .atm-threadrow__last { flex-wrap: wrap; }
    @container (max-width: 650px) {
      .atm-threadrow { grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
      .atm-threadrow__nums { display: block; grid-column: 1; text-align: left; }
      .atm-threadrow__last { display: flex; grid-column: 1; }
    }
  }
</style>
