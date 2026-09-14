<script lang="ts">
  // The atmo.pub panel: what the relay is, where this member stands with it,
  // and the one action that fits. Settings and the notifications page both
  // show it; `action` points the forms at the settings actions from elsewhere
  // and `next` brings the member back to the page they were on.
  let {
    status,
    canSend,
    canRetry,
    dashboardUrl,
    reconsented = false,
    action = '',
    next,
    muted = false,
  }: {
    status: string;
    canSend: boolean;
    canRetry: boolean;
    dashboardUrl: string;
    reconsented?: boolean;
    action?: string;
    next: string;
    muted?: boolean;
  } = $props();
</script>

<section class="atm-card atm-notify-delivery" aria-labelledby="notify-delivery-title">
  <header id="notify-delivery-title" class="atm-card__header">atmo.pub</header>
  <div class="atm-card__body">
    <p class="explain">
      This forum sends notifications through <a href={dashboardUrl} target="_blank" rel="noopener">atmo.pub</a>,
      a relay for atmosphere apps. Approve the forum there once, then choose where alerts go:
      web push, email, Telegram, or a Bluesky DM. The forum never sees those channels, and you
      can cut it off from atmo.pub whenever you like.
    </p>
    {#if !canSend}
      <p class="atm-notice">This forum can't send notifications yet: it needs to run on an https address first.</p>
    {:else if status === 'on'}
      <p class="state">{muted ? 'This forum is connected, but notifications are off in your preferences.' : 'Notifications are on.'}</p>
      <form method="POST" action="{action}?/disable">
        <input type="hidden" name="next" value={next} />
        <button class="atm-btn atm-btn--secondary">{muted ? 'Disable forum delivery' : 'Turn off'}</button>
      </form>
    {:else if status === 'pending'}
      <p class="state">
        Waiting for your approval on
        <a href={dashboardUrl} target="_blank" rel="noopener">atmo.pub</a>.
      </p>
      <form method="POST" action="{action}?/enable">
        {#if reconsented}<input type="hidden" name="reconsented" value="1" />{/if}
        <input type="hidden" name="next" value={next} />
        <button class="atm-btn atm-btn--primary" disabled={!canRetry}>Ask again</button>
      </form>
    {:else}
      <form method="POST" action="{action}?/enable">
        {#if reconsented}<input type="hidden" name="reconsented" value="1" />{/if}
        <input type="hidden" name="next" value={next} />
        <button class="atm-btn atm-btn--primary">Connect to atmo.pub</button>
      </form>
    {/if}
  </div>
</section>

<style>
  @layer atmobb {
  .explain { margin: 0 0 var(--space-3); font: var(--type-meta); color: var(--forum-ink-soft); }
  .state { margin: 0 0 var(--space-3); color: var(--forum-ink); }
  }
</style>
