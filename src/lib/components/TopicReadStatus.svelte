<script lang="ts">
  import {
    readReadingState,
    readingStateEvent,
    readingStorageKey,
    topicReadState,
    type TopicReadState,
  } from '$lib/reading-state';

  let {
    accountDid,
    forumDid,
    threadUri,
    canonicalHref,
    createdAt,
    lastActivity,
    replyCount,
    lastPostBy,
  }: {
    accountDid?: string | null;
    forumDid: string;
    threadUri: string;
    canonicalHref: string;
    createdAt?: string;
    lastActivity?: string;
    replyCount: number;
    lastPostBy?: string;
  } = $props();

  let state = $state<TopicReadState>(null);

  $effect(() => {
    state = null;
    if (!accountDid || !forumDid) return;
    const scope = { accountDid, forumDid };
    const activity = { threadUri, canonicalHref, createdAt, lastActivity, replyCount, viewerDid: accountDid, lastPostBy };
    const refresh = () => {
      try {
        state = topicReadState(readReadingState(localStorage, scope), activity);
      } catch {
        // Accessing localStorage itself can throw when browser storage is blocked.
        state = null;
      }
    };
    const eventName = readingStateEvent(scope);
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === readingStorageKey(scope)) refresh();
    };
    refresh();
    window.addEventListener(eventName, refresh);
    window.addEventListener('storage', storageChanged);
    return () => {
      window.removeEventListener(eventName, refresh);
      window.removeEventListener('storage', storageChanged);
    };
  });
</script>

{#if state}
  <span class="atm-topic-read-status atm-topic-read-status--{state.status}" aria-label="Topic status: {state.status}">
    <span class="atm-topic-read-status__dot" aria-hidden="true"></span>
    <span class="atm-topic-read-status__label">{state.status}</span>
    {#if state.status === 'unread'}
      <a class="atm-topic-read-status__resume" href={state.resumeHref}>resume</a>
    {/if}
  </span>
{/if}

<style>
  @layer atmobb {
  .atm-topic-read-status {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: var(--type-meta);
    color: var(--forum-ink-soft);
    white-space: nowrap;
  }
  .atm-topic-read-status__dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: currentColor;
    flex: none;
  }
  .atm-topic-read-status--new,
  .atm-topic-read-status--unread { color: var(--forum-link); font-weight: var(--w-semibold); }
  .atm-topic-read-status--read .atm-topic-read-status__dot { opacity: 0.45; }
  .atm-topic-read-status__resume { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  }
</style>
