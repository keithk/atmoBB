<script lang="ts">
  import { enhance } from '$app/forms';
  import Card from '$lib/components/Card.svelte';
  import NotifyDelivery from '$lib/components/NotifyDelivery.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { message?: string; saved?: boolean } | null } = $props();
  let scope = $state('forum');
</script>

<div class="wrap">
  <nav class="atm-crumbs">
    <a href="/settings/profile">edit profile</a><span class="atm-crumbs__sep">›</span>
    <span class="atm-crumbs__current">notifications</span>
  </nav>

  <h1 class="title">Notifications</h1>
  <p class="lede">Choose an account default or a notification preference just for this forum.</p>
  {#if form?.message}<p class="atm-err">{form.message}</p>{/if}

  <Card title="Notification preferences">
    <form method="POST" action="?/preferences" class="preferences" use:enhance>
      <label class="atm-field">
        <span class="atm-label">Apply to</span>
        <select class="atm-input" name="scope" bind:value={scope}>
          <option value="forum">This forum only</option>
          <option value="all">All atmobb forums</option>
        </select>
        <span class="atm-hint">{scope === 'forum' ? data.forum.name : 'Account default; existing forum choices stay unchanged.'}</span>
      </label>
      <label class="atm-field">
        <span class="atm-label">Notifications</span>
        {#key `${scope}:${data.globalNotifications}:${data.localNotifications}`}
          <select class="atm-input" name="notifications" value={scope === 'forum' ? data.localNotifications : data.globalNotifications}>
            {#if scope === 'forum'}<option value="inherit">Use my account default</option>{/if}
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        {/key}
      </label>
      <p class="lede">Account defaults leave existing forum choices unchanged. These preferences are public on your account and may take up to five minutes to reach other forums. Turning notifications on does not connect any new forums; approve each forum below.</p>
      <div>
        <button class="atm-btn atm-btn--primary">Save preferences</button>
        {#if form?.saved}<span class="atm-ok" role="status">Notification preferences saved ✓</span>{/if}
      </div>
    </form>
  </Card>

  <NotifyDelivery
    status={data.status}
    canSend={data.canSend}
    canRetry={data.canRetry}
    dashboardUrl={data.dashboardUrl}
    reconsented={data.reconsented}
    next="/settings/notifications"
    muted={(data.localNotifications === 'inherit' ? data.globalNotifications : data.localNotifications) === 'off'}
  />

  <Card title="Boards you watch">
    {#if data.watches.length === 0}
      <p class="atm-empty">You're not watching any boards yet.</p>
    {:else}
      <ul class="watches">
        {#each data.watches as w (w.board)}
          <li class="watches__row">
            <a href={w.href}>{w.name}</a>
            <form method="POST" action="?/unwatch" use:enhance>
              <input type="hidden" name="board" value={w.board} />
              <button class="atm-btn atm-btn--secondary atm-btn--sm">Unwatch</button>
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</div>

<style>
  @layer atmobb {
  .wrap { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); }
  .title { font: var(--type-page-title); color: var(--forum-ink); margin: 0; }
  .lede { margin: 0; font: var(--type-meta); color: var(--forum-ink-soft); }
  .preferences { display: grid; gap: var(--space-4); }
  .watches { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .watches__row { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
  }
</style>
