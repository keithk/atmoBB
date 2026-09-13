<script lang="ts">
  import { page } from '$app/state';

  // Stands in for a write control a non-member of a gated forum can't use
  // (R22): the way in for the forum's mode, or the last step for someone the
  // forum accepted whose own declaration is missing (R20).
  let { action = 'post here' }: { action?: string } = $props();
  const user = $derived(page.data.user);
  const next = $derived(page.url.pathname + page.url.search);
</script>

<div class="atm-notice atm-join-notice">
  {#if page.data.standing === 'accepted-undeclared'}
    <p>You've been accepted here. Finish joining to {action}.</p>
    <form method="POST" action="/?/join">
      <input type="hidden" name="next" value={next} />
      <button class="atm-btn atm-btn--primary atm-btn--sm">Finish joining</button>
    </form>
  {:else if page.data.joinMode === 'invite'}
    <p>Only members can {action}. This forum is invite only.</p>
  {:else if user}
    <p>Only members can {action}. <a href="/apply">Apply to join</a>.</p>
  {:else}
    <p>Only members can {action}. <a href="/login">Log in</a> to apply to join.</p>
  {/if}
</div>

<style>
  @layer atmobb {
  .atm-join-notice { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .atm-join-notice p { margin: 0; }
  }
</style>
