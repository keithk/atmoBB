<script lang="ts">
  // The one-time offer after a member's first post (KTD11). Plain forms, no
  // enhance: turning on must land on the settings page, where the outcome
  // is shown, and enhance would keep the result on this page instead.
  let { next }: { next: string } = $props();
</script>

<section class="atm-notify-prompt" aria-labelledby="notify-prompt-title">
  <h2 id="notify-prompt-title" class="atm-notify-prompt__title">Want to know when someone replies?</h2>
  <p class="atm-notify-prompt__lede">Turn on notifications and atmo.pub delivers them wherever you've set up there.</p>
  <div class="atm-notify-prompt__actions">
    <form method="POST" action="/settings/notifications?/enable">
      <button class="atm-btn atm-btn--primary atm-btn--sm">Turn on</button>
    </form>
    <form method="POST" action="/settings/notifications?/dismissPrompt">
      <input type="hidden" name="next" value={next} />
      <button class="atm-btn atm-btn--secondary atm-btn--sm">No thanks</button>
    </form>
  </div>
</section>

<style>
  @layer atmobb {
  .atm-notify-prompt {
    border: 1px solid var(--forum-line);
    border-radius: var(--radius-md);
    background: var(--forum-surface);
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .atm-notify-prompt__title { margin: 0; font: var(--type-section); color: var(--forum-ink); }
  .atm-notify-prompt__lede { margin: 0; font: var(--type-meta); color: var(--forum-ink-soft); }
  .atm-notify-prompt__actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  }
</style>
