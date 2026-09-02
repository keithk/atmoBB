<script lang="ts">
  import Avatar from './Avatar.svelte';
  import { profileHref, type ProfileCard } from '$lib/profile-card';
  import { relTime } from '$lib/reltime';

  let { card }: { card: ProfileCard } = $props();

  const joined = $derived(
    card.joined ? new Date(card.joined).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : null,
  );
</script>

<div class="atm-hovercard">
  <div class="atm-hovercard__head">
    <Avatar
      seed={card.did}
      profile={card.profile}
      size={72}
      presence={card.presence}
      alt={card.displayName}
    />
    <div class="atm-hovercard__id">
      <span class="atm-hovercard__name">{card.displayName}</span>
      <code class="atm-hovercard__handle">@{card.handle}</code>
      {#if card.rankTitle}<span class="atm-rank">{card.rankTitle}</span>{/if}
    </div>
  </div>

  <div class="atm-hovercard__stats">
    <span>
      {card.posts != null ? card.posts : 'No'} <i>{card.posts === 1 ? 'post' : 'posts'} here</i>
      {#if card.globalPosts != null}<i> · </i>{card.globalPosts} <i>public {card.globalPosts === 1 ? 'post' : 'posts'} across atmobb</i>{/if}
    </span>
    {#if joined}<span class="atm-hovercard__joined">joined {joined}</span>{/if}
    <span class="atm-presence atm-presence--{card.presence} atm-hovercard__presence">{card.presence}</span>
  </div>

  {#if card.bsky}
    <a class="atm-hovercard__bsky" href="https://bsky.app/profile/{card.bsky.handle}" target="_blank" rel="noopener">
      <span aria-hidden="true">🦋</span> @{card.bsky.handle}
    </a>
  {/if}

  <div class="atm-hovercard__foot">
    {#if card.isYou}
      <a class="atm-btn atm-btn--secondary atm-btn--sm" href="/settings/profile">Edit profile</a>
    {:else}
      <a class="atm-btn atm-btn--primary atm-btn--sm" href={profileHref(card.did)}>Profile →</a>
    {/if}
  </div>
</div>

<style>
  @layer atmobb {
  .atm-hovercard {
    width: 320px;
    background: var(--forum-surface);
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .atm-hovercard__head {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--forum-surface-2);
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .atm-hovercard__id { display: flex; flex-direction: column; gap: 3px; min-width: 0; align-items: flex-start; }
  .atm-hovercard__name { font: var(--w-bold) var(--text-md)/1.2 var(--font-display); color: var(--forum-ink); }
  .atm-hovercard__handle { font: var(--type-handle); color: var(--forum-ink-faint); }
  .atm-hovercard__stats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-bottom: var(--border-hair) solid var(--forum-line);
    font: var(--type-meta);
    color: var(--forum-ink-soft);
  }
  .atm-hovercard__stats i { font-style: normal; }
  .atm-hovercard__stats span:first-child { color: var(--forum-ink); font-weight: var(--w-semibold); }
  .atm-hovercard__joined { margin-right: auto; }
  .atm-hovercard__presence { text-transform: capitalize; }
  .atm-hovercard__bsky {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-bottom: var(--border-hair) solid var(--forum-line);
    font: var(--type-handle);
    color: var(--forum-link);
    text-decoration: none;
  }
  .atm-hovercard__bsky:hover { background: var(--forum-surface-2); }
  .atm-hovercard__foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }
  }
</style>
