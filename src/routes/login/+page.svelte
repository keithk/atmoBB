<script lang="ts">
  import AtmosphereExplainer from '$lib/components/AtmosphereExplainer.svelte';
  import LoginForm from '$lib/components/LoginForm.svelte';

  let { form } = $props();
</script>

<div class="login">
  <h2 class="atm-headline login__headline">
    Log in with your <mark>atmosphere account</mark>.
  </h2>

  {#if form?.message}<p class="atm-err">{form.message}</p>{/if}

  <LoginForm action="?/login" handle={form?.handle ?? ''} />

  <div class="login__more">
    <AtmosphereExplainer />
  </div>
</div>

<style>
  @layer atmobb {
  .login { max-width: 560px; }
  .login__headline { margin-bottom: var(--space-5); }
  .login__more { margin-top: var(--space-6); }
  }
</style>
