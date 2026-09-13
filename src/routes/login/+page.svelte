<script lang="ts">
  import LoginCard from '$lib/components/LoginCard.svelte';
  import { page } from '$app/state';

  let { form } = $props();
</script>

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
  .login { max-width: 72ch; }
  }
</style>
