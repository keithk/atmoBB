<script lang="ts">
  import { boardPath, threadPath } from '$lib/appview-paths';
  import Avatar from '$lib/components/Avatar.svelte';
  import MemberLink from '$lib/components/MemberLink.svelte';
  import { relTime } from '$lib/reltime';

  let { data } = $props();

  const name = (t: { author: string; authorProfile?: { displayName?: string } }) =>
    t.authorProfile?.displayName ?? data.handles[t.author] ?? t.author.slice(8, 18);
</script>

<div class="atm-panel">
  <div class="atm-board-section">Latest activity</div>
  {#each data.threads as t}
    <article class="atm-threadrow">
      <span class="atm-threadrow__flag" aria-hidden="true">▤</span>
      <div>
        <div class="atm-threadrow__title">
          <a href={threadPath(t.uri)}>{t.title}</a>
        </div>
        <div class="atm-threadrow__sub">
          <span>by <MemberLink did={t.author}>{name(t)}</MemberLink></span>
          {#if t.boardName}
            <span>in <a href={boardPath(t.board, data.forumDid)}>{t.boardName}</a></span>
          {/if}
          {#if t.origin}
            <span>· via <span class="atm-via">{t.origin.name ?? t.origin.did.slice(8, 24)}</span></span>
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
    <p class="atm-empty">No activity yet. Start the first thread.</p>
  {/each}
</div>

{#if data.cursor}
  <p class="atm-more"><a href="?cursor={data.cursor}">older activity →</a></p>
{/if}
