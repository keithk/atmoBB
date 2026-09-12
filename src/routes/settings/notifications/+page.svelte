<script lang="ts">
  import { enhance } from '$app/forms';
  import Card from '$lib/components/Card.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { message?: string } | null } = $props();
</script>

<div class="wrap">
  <nav class="atm-crumbs">
    <a href="/settings/profile">edit profile</a><span class="atm-crumbs__sep">›</span>
    <span class="atm-crumbs__current">notifications</span>
  </nav>

  <h1 class="title">Notifications</h1>
  <p class="lede">Choose what this forum tells you about and where.</p>
  {#if form?.message}<p class="atm-err">{form.message}</p>{/if}

  <Card title="Delivery">
    {#if !data.canSend}
      <p class="atm-notice">This forum can't send notifications yet: it needs to run on an https address first.</p>
    {:else if data.status === 'on'}
      <p class="state">Notifications are on.</p>
      <form method="POST" action="?/disable" use:enhance>
        <button class="atm-btn atm-btn--secondary">Turn off</button>
      </form>
    {:else if data.status === 'pending'}
      <p class="state">
        Waiting for your approval on
        <a href={data.dashboardUrl} target="_blank" rel="noopener">atmo.pub</a>.
      </p>
      <form method="POST" action="?/enable" use:enhance>
        {#if data.reconsented}<input type="hidden" name="reconsented" value="1" />{/if}
        <button class="atm-btn atm-btn--primary" disabled={!data.canRetry}>Ask again</button>
      </form>
    {:else}
      <p class="explain">
        atmo.pub delivers them to wherever you've set up there, and this forum only ever asks once you approve it.
      </p>
      <form method="POST" action="?/enable" use:enhance>
        {#if data.reconsented}<input type="hidden" name="reconsented" value="1" />{/if}
        <button class="atm-btn atm-btn--primary">Turn on notifications</button>
      </form>
    {/if}
  </Card>

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
  .state { margin: 0 0 var(--space-3); color: var(--forum-ink); }
  .explain { margin: 0 0 var(--space-3); font: var(--type-meta); color: var(--forum-ink-soft); }
  .watches { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .watches__row { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
  }
</style>
