<script lang="ts">
  import { enhance } from '$app/forms';
  import Card from '$lib/components/Card.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { message?: string; accepted?: boolean } | null } = $props();
</script>

<div class="wrap">
  <h1 class="title">Join {data.forumName}</h1>

  {#if form?.accepted}
    <p class="atm-notice atm-notice--waiting">{form.message}</p>
    <p><a class="atm-btn atm-btn--primary" href="/">Go to the home page</a></p>
  {:else if data.view === 'confirm'}
    <Card>
      <p class="lede">
        <strong>@{data.inviter}</strong> invited you to join <strong>{data.forumName}</strong>.
        Accepting makes you a member right away, and @{data.inviter} is recorded as your sponsor.
      </p>
      {#if form?.message}<p class="atm-err">{form.message}</p>{/if}
      <form method="POST" action="?/confirm" use:enhance>
        <button class="atm-btn atm-btn--primary">Join {data.forumName}</button>
      </form>
    </Card>
  {:else}
    <p class="atm-notice" class:atm-notice--danger={data.view === 'banned'}>{data.message}</p>
    <p><a href="/">Back to the forum</a></p>
  {/if}
</div>

<style>
  @layer atmobb {
  .wrap { max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); }
  .title { font: var(--type-page-title); color: var(--forum-ink); margin: 0; }
  .lede { margin: 0 0 var(--space-4); }
  }
</style>
