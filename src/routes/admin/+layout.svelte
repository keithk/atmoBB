<script lang="ts">
  import { page } from '$app/state';

  let { data, children } = $props();

  const tabs = $derived([
    { label: 'Profile', href: '/admin' },
    { label: 'Appearance', href: '/admin/appearance' },
    { label: 'Boards', href: '/admin/boards' },
    { label: 'Staff', href: '/admin/staff' },
    { label: 'Topics', href: '/admin/topics' },
    ...(data.hostingEnabled ? [{ label: 'Hosting', href: '/admin/hosting' }] : []),
    { label: 'Connection', href: '/admin/connect' },
  ]);
  const isActive = (href: string) =>
    href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);

  const needsConnection = $derived(data.writeMode === 'pds' && !data.connected);
</script>

<div class="admin">
  <div class="admin__head">
    <h1 class="admin__title">Admin</h1>
    {#if data.writeMode === 'index'}
      <span class="atm-chip admin__chip--dev">development mode</span>
    {:else if data.connected}
      <span class="atm-chip atm-chip--ok">forum account connected</span>
    {:else}
      <span class="atm-chip atm-chip--warn">forum account not connected</span>
    {/if}
  </div>

  <nav class="atm-tabs admin__nav" aria-label="Admin">
    {#each tabs as tab}
      <a
        class="atm-tab {isActive(tab.href) ? 'atm-tab--active' : ''}"
        href={tab.href}
        aria-current={isActive(tab.href) ? 'page' : undefined}>{tab.label}</a>
    {/each}
  </nav>

  {#if needsConnection && page.url.pathname !== '/admin/connect'}
    <p class="admin__warn">
      Saving is disabled until the forum account is connected.
      <a href="/admin/connect">Connect the account →</a>
    </p>
  {/if}

  {@render children()}
</div>

<style>
  .admin__head {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .admin__title { font: var(--type-page-title); color: var(--forum-ink); margin: 0; }
  .admin__chip--dev { color: var(--forum-ink-faint); }
  .admin__nav { margin-bottom: var(--space-5); }

  .admin__warn {
    background: var(--warn-bg);
    border: var(--border-hair) solid color-mix(in oklch, var(--warn-1) 40%, transparent);
    color: var(--forum-ink);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font: var(--type-ui);
    margin-bottom: var(--space-4);
  }
</style>
