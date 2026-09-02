<script lang="ts">
  let { action = '/login?/login', handle = '' }: { action?: string; handle?: string } = $props();
</script>

<form method="POST" {action} class="atm-loginform">
  <input
    class="atm-input"
    name="handle"
    placeholder="your.handle"
    value={handle}
    autocapitalize="none"
    autocorrect="off"
    spellcheck="false"
    required
  />
  <button class="atm-btn atm-btn--primary">continue →</button>
</form>
<p class="atm-loginform__note">
  Your account provider handles sign-in, so atmobb never sees your password.
  You'll review the permissions atmobb requests before continuing.
</p>

<style>
  @layer atmobb {
  .atm-loginform { display: flex; gap: var(--space-2); }
  .atm-loginform .atm-input { flex: 1; min-width: 0; width: auto; }
  .atm-loginform__note {
    font: var(--type-meta);
    color: var(--forum-ink-soft);
    margin-top: var(--space-2);
  }
  @media (max-width: 360px) {
    .atm-loginform { flex-wrap: wrap; }
    .atm-loginform .atm-input { flex-basis: 100%; }
    .atm-loginform .atm-btn { width: 100%; }
  }
  }
</style>
