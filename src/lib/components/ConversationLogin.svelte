<script lang="ts">
  import { onMount } from 'svelte';
  import AppStack from './AppStack.svelte';
  import AtmosphereCard from './AtmosphereCard.svelte';
  import AtmosphereExplainer from './AtmosphereExplainer.svelte';
  import { networkApps, randomNetworkApp } from '$lib/network-apps';

  let featuredApp = $state(networkApps[0]);

  // Keep SSR stable, then rotate the example once the card reaches the browser.
  onMount(() => {
    featuredApp = randomNetworkApp();
  });
</script>

<div class="join">
  <AtmosphereCard badge="↩">
    <div class="atm-eyebrow atm-eyebrow--accent atm-pitch__eyebrow">have something to add?</div>
    <h3 class="atm-pitch__title">Jump into the conversation.</h3>
    <p class="atm-pitch__body">
      Already use <strong>Bluesky, {featuredApp.name}, or another app on the network?</strong>
      You already have an atmosphere account. Log in with it here to add your
      reply—there's no separate forum account to create.
    </p>

    <div class="atm-pitch__actions">
      <a class="atm-btn atm-btn--primary atm-btn--lg" href="/login">log in &amp; reply →</a>
      <AppStack featured={featuredApp} />
    </div>

    <div class="atm-pitch__more">
      <AtmosphereExplainer />
    </div>
  </AtmosphereCard>
</div>

<style>
  @layer atmobb {
  .join { max-width: 72ch; margin-top: var(--space-6); }
  }
</style>
