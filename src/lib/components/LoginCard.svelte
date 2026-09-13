<script lang="ts">
  import { onMount } from 'svelte';
  import AppStack from './AppStack.svelte';
  import AtmosphereCard from './AtmosphereCard.svelte';
  import AtmosphereExplainer from './AtmosphereExplainer.svelte';
  import LoginForm from './LoginForm.svelte';
  import { networkApps, randomNetworkApp } from '$lib/network-apps';

  let {
    action = '/login?/login',
    handle = '',
    next = '',
    message = '',
  }: { action?: string; handle?: string; next?: string; message?: string } = $props();

  let featuredApp = $state(networkApps[0]);

  // Keep SSR stable, then rotate the example once the card reaches the browser.
  onMount(() => {
    featuredApp = randomNetworkApp();
  });
</script>

<AtmosphereCard badge="→">
  <div class="atm-eyebrow atm-eyebrow--accent atm-pitch__eyebrow">already on the network?</div>
  <h2 class="atm-pitch__title">Log in with your <mark>atmosphere account</mark>.</h2>
  <p class="atm-pitch__body">
    Already use <strong>Bluesky, {featuredApp.name}, or another app on the network?</strong>
    That's your atmosphere account. Log in with it here—there's no separate
    forum account to create.
  </p>

  {#if message}<p class="atm-err">{message}</p>{/if}

  <div class="login-card__form">
    <LoginForm {action} {handle} {next} />
  </div>

  <div class="atm-pitch__actions">
    <AppStack featured={featuredApp} />
  </div>

  <div class="atm-pitch__more">
    <AtmosphereExplainer />
  </div>
</AtmosphereCard>

<style>
  @layer atmobb {
  .login-card__form { max-width: 56ch; margin-top: var(--space-4); }
  }
</style>
