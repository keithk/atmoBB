<script lang="ts">
  import AtmosphereExplainer from '$lib/components/AtmosphereExplainer.svelte';
</script>

<div class="register">
  <h2 class="atm-headline register__headline">
    You don't need a separate <mark>account</mark> for this forum.
  </h2>
  <p class="register__body">
    Sign in with an atmosphere account from Bluesky or another app on the
    network. If you don't have one, create one on Bluesky, then come back here
    to log in.
  </p>
  <div class="register__actions">
    <a class="atm-btn atm-btn--primary" href="https://bsky.app/" target="_blank" rel="noopener">
      create an account on Bluesky →
    </a>
    <a class="atm-btn atm-btn--ghost" href="/login">log in with an existing account</a>
  </div>

  <div class="register__more">
    <AtmosphereExplainer />
  </div>
</div>

<style>
  @layer atmobb {
  .register { max-width: 560px; }
  .register__headline { margin-bottom: var(--space-4); }
  .register__body {
    font: var(--type-body);
    color: var(--forum-ink);
    margin-bottom: var(--space-4);
  }
  .register__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .register__more { margin-top: var(--space-6); }
  }
</style>
