<script lang="ts">
  import { page } from '$app/state';
  let { children } = $props();
</script>

<div class="settings">
  <nav class="atm-tabs" aria-label="Settings">
    {#each [{ label: 'Profile', href: '/settings/profile' }, { label: 'Styles', href: '/settings/styles' }] as tab}
      <a class="atm-tab {page.url.pathname === tab.href ? 'atm-tab--active' : ''}"
        href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined}>{tab.label}</a>
    {/each}
  </nav>
  {@render children()}
</div>

<style>
  @layer atmobb {
    .settings { width: 100%; min-width: 0; display: grid; gap: var(--space-4); }
  }
</style>
