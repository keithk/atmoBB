<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { message?: string; note?: string } | null } = $props();
</script>

<svelte:head><title>Apply to join {data.forum.name}</title></svelte:head>

<div class="apply">
  <h1 class="apply__title">Apply to join {data.forum.name}</h1>

  {#if data.view.kind === 'banned'}
    <p class="atm-notice">{data.view.message}</p>
  {:else if data.view.kind === 'open'}
    <p class="atm-notice">This forum is open; join from the <a href="/">home page</a>.</p>
  {:else if data.view.kind === 'invite'}
    <p class="atm-notice">This forum is invite only.</p>
  {:else if data.view.kind === 'member'}
    <p class="atm-notice">You're already a member here.</p>
  {:else if data.view.kind === 'accepted'}
    <p class="atm-notice">You've been approved. Use the "Finish joining" button above to join.</p>
  {:else if data.view.kind === 'pending'}
    {#if data.sent}<p class="atm-ok">Application sent.</p>{/if}
    <p class="atm-notice">Your application is waiting for review.</p>
  {:else if data.view.kind === 'waiting'}
    <p class="atm-notice">The moderators asked for more; check your Bluesky messages.</p>
  {:else}
    {#if data.sent && data.pending}
      <p class="atm-ok">Application sent. It's on its way to the moderators; this page will catch up shortly.</p>
    {/if}
    {#if data.view.declined}
      <p class="atm-notice">Your last application was declined; you can apply again.</p>
    {/if}
    {#if form?.message}<p class="atm-err">{form.message}</p>{/if}
    <form class="apply__form" method="POST" use:enhance>
      <label class="atm-field">
        <span class="atm-label">{data.prompt}</span>
        <textarea class="atm-textarea" name="note" rows="5" required>{form?.note ?? ''}</textarea>
        <span class="atm-hint">Up to {data.noteMax} characters.</span>
      </label>
      <p class="apply__public">Your application is a public record on your account.</p>
      <button class="atm-btn atm-btn--primary">Send application</button>
    </form>
  {/if}
</div>

<style>
  @layer atmobb {
  .apply { max-width: 60ch; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); }
  .apply__title { font: var(--type-page-title); color: var(--forum-ink); margin: 0; }
  .apply__form { display: flex; flex-direction: column; gap: var(--space-3); align-items: flex-start; }
  .apply__form .atm-field { align-self: stretch; }
  .apply__public { margin: 0; font: var(--type-meta); color: var(--forum-ink-soft); }
  }
</style>
