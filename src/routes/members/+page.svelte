<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import RankBadge from '$lib/components/RankBadge.svelte';
  import MemberLink from '$lib/components/MemberLink.svelte';
  import { relTime } from '$lib/reltime';

  let { data } = $props();
</script>

{#if data.membership?.joined}
  <div class="atm-membership">
    <span>You're a member here.</span>
    <form method="POST" action="/?/leave">
      <button class="atm-linkbtn">leave</button>
    </form>
  </div>
{/if}

<div class="atm-panel">
  <div class="atm-board-section">Members</div>
  {#each data.members as m}
    <article class="atm-memberrow">
      <Avatar seed={m.did} profile={m.profile} size={40} />
      <div class="atm-memberrow__id">
        <MemberLink did={m.did} handle={data.handles[m.did]} class="atm-memberrow__name">
          {m.profile?.displayName ?? data.handles[m.did]}
        </MemberLink>
        {#if m.profile?.displayName}
          <code class="atm-memberrow__handle">@{data.handles[m.did]}</code>
        {/if}
        {#if m.profile?.title}
          <div class="atm-usertitle">{m.profile.title}</div>
        {/if}
      </div>
      <div class="atm-memberrow__rank">
        <RankBadge ranks={data.ranks} posts={m.posts} />
      </div>
      <div class="atm-memberrow__posts">
        <b>{m.posts}</b> posts{#if m.totalPosts > m.posts}
          · <b>{m.totalPosts}</b> in the atmosphere{/if}
      </div>
      <div class="atm-memberrow__seen">{m.lastActive ? `active ${relTime(m.lastActive)}` : ''}</div>
    </article>
  {:else}
    <p class="atm-empty">No members yet.</p>
  {/each}
</div>

{#if data.cursor}
  <p class="atm-more"><a href="?cursor={data.cursor}">more members →</a></p>
{/if}
