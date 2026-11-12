<script lang="ts">
  import PageBar from '$lib/components/PageBar.svelte';
  import LoginCard from '$lib/components/LoginCard.svelte';
  import { page } from '$app/state';

  let { form } = $props();
</script>

<PageBar title="Log in" />

<div class="login">
  <LoginCard
    action="?/login"
    handle={form?.handle ?? ''}
    next={page.url.searchParams.get('next') ?? ''}
    message={form?.message ?? ''}
  />
</div>

<style>
  @layer atmobb {
  .login { max-width: 72ch; margin-inline: auto; }
  }
</style>
