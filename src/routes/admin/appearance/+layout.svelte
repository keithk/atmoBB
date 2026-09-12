<script lang="ts">
  import { page } from '$app/state';

  let { children } = $props();

  const tabs = [
    { label: 'Theme', href: '/admin/appearance' },
    { label: 'Homepage', href: '/admin/appearance/homepage' },
    { label: 'Branding', href: '/admin/appearance/branding' },
    { label: 'Custom CSS', href: '/admin/appearance/css' },
  ];
  const isActive = (href: string) =>
    href === '/admin/appearance' ? page.url.pathname === href : page.url.pathname.startsWith(href);

  const SAVED_MESSAGES: Record<string, string> = {
    theme: 'Theme saved.',
    homepage: 'Homepage settings saved.',
    favicon: 'Favicon saved.',
    'favicon-removed': 'Default favicon restored.',
    og: 'Social preview saved.',
    'og-theme': 'Social preview style saved.',
    'og-removed': 'Default social preview restored.',
    css: 'CSS saved.',
    font: 'Font uploaded.',
    removed: 'Font removed.',
  };
  const saved = $derived(page.url.searchParams.get('saved'));
  const savedMessage = $derived(saved ? SAVED_MESSAGES[saved] ?? 'Saved.' : null);
  const pending = $derived(page.url.searchParams.has('pending'));
</script>

<nav class="subnav" aria-label="Appearance">
  {#each tabs as tab}
    <a
      class="atm-btn atm-btn--sm {isActive(tab.href) ? 'atm-btn--secondary' : 'atm-btn--ghost'}"
      href={tab.href}
      aria-current={isActive(tab.href) ? 'page' : undefined}>{tab.label}</a>
  {/each}
</nav>

{#if savedMessage}
  <p class="atm-ok">
    {savedMessage}
    {#if pending} The change is taking a few extra seconds to show up here — refresh to see it.{/if}
  </p>
{/if}

{@render children()}

<style>
  .subnav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: calc(-1 * var(--space-2)) 0 var(--space-4);
  }
</style>
