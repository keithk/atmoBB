<script lang="ts">
  import { enhance } from '$app/forms';
  import Card from '$lib/components/Card.svelte';
  import NotifyDelivery from '$lib/components/NotifyDelivery.svelte';
  import { relTime } from '$lib/reltime';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { message?: string } | null } = $props();

  const deliveryNote: Record<string, string> = {
    undelivered: "couldn't be delivered to your channels",
    skipped: 'not sent to your channels',
  };
  const unread = $derived(data.entries.filter((e) => !e.read).length);
</script>

<svelte:head><title>Notifications</title></svelte:head>

<div class="wrap">
  <header class="head">
    <h1 class="title">Notifications</h1>
    {#if unread > 0}
      <form method="POST" action="?/readAll" use:enhance>
        <button class="atm-btn atm-btn--secondary atm-btn--sm">Mark all read</button>
      </form>
    {/if}
  </header>
  <NotifyDelivery
    status={data.status}
    canSend={data.canSend}
    canRetry={data.canRetry}
    dashboardUrl={data.dashboardUrl}
    action="/settings/notifications"
    next="/notifications"
    muted={data.avatarProfile?.notifications === false}
  />

  <Card title="Recent">
    {#if form?.message}<p class="atm-err">{form.message}</p>{/if}
    {#if data.entries.length === 0}
      <p class="atm-empty">Nothing yet. You'll see replies, mentions, and watched-board threads here.</p>
    {:else}
      <ul class="list">
        {#each data.entries as entry (entry.id)}
          <li class="atm-notification" class:atm-notification--unread={!entry.read}>
            <a class="atm-notification__link" href="/notifications/open/{entry.id}">
              <span class="atm-notification__title">{entry.title}</span>
              {#if entry.body}<span class="atm-notification__body">{entry.body}</span>{/if}
              <span class="atm-notification__meta">
                <time datetime={entry.at}>{relTime(entry.at)}</time>
                {#if deliveryNote[entry.delivery]}<span class="atm-notification__delivery">· {deliveryNote[entry.delivery]}</span>{/if}
              </span>
            </a>
            {#if !entry.read}
              <form method="POST" action="?/read" use:enhance>
                <input type="hidden" name="id" value={entry.id} />
                <button class="atm-btn atm-btn--ghost atm-btn--sm">Mark read</button>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</div>

<style>
  @layer atmobb {
  .wrap { display: flex; flex-direction: column; gap: var(--space-4); }
  .head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
  .title { font: var(--type-page-title); color: var(--forum-ink); margin: 0; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .atm-notification {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: var(--border-hair) solid var(--forum-line);
  }
  .atm-notification:first-child { border-top: 0; }
  .atm-notification__link { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; text-decoration: none; color: var(--forum-ink-soft); }
  .atm-notification__link:hover .atm-notification__title { text-decoration: underline; }
  .atm-notification__title { color: var(--forum-ink); }
  .atm-notification--unread .atm-notification__title { font-weight: var(--w-bold); }
  .atm-notification__body {
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .atm-notification__meta { font: var(--type-meta); color: var(--forum-ink-faint); }
  }
</style>
