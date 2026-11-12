<script lang="ts">
  import '$lib/styles/index.css';
  import { page } from '$app/state';
  import { onNavigate } from '$app/navigation';
  import Logo from '$lib/components/Logo.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import ForumSidebarNav from '$lib/components/ForumSidebarNav.svelte';
  import ForumSidebarDrawer from '$lib/components/ForumSidebarDrawer.svelte';
  import { groupBoards } from '$lib/board-presentation';
  import { resolveMetadata, serializeStructuredData, type PageMetadata } from '$lib/seo';
  import { themeColor, themeCss } from '$lib/themes';

  let { data, children } = $props();

  // Cross-fade the content panel between pages where the browser supports it.
  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  const sidebarGroups = $derived(groupBoards(data.sidebarBoards, data.sidebarCategories));
  let sidebarDrawer = $state<ForumSidebarDrawer>();

  // Built-in theme first, then fonts, owner CSS, and personal theme tokens. The theme preset is
  // curated and cannot break the admin, so it applies everywhere; owner CSS
  // stays off admin pages so a broken stylesheet is always repairable.
  const appearanceCss = $derived(
    [
      themeCss(data.forumTheme),
      data.forumFontCss,
      page.url.pathname.startsWith('/admin') ? '' : data.forumCustomCss,
      data.personalThemeCss,
    ].filter(Boolean).join('\n'),
  );

  // One document-level source of truth keeps search, Open Graph, Twitter, and
  // structured data in sync. Public dynamic routes provide `metadata` from
  // their server load; static sections get useful defaults from the route id.
  const metadata = $derived(resolveMetadata({
    routeId: page.route.id,
    url: page.url,
    status: page.status,
    siteName: data.forum.name,
    siteDescription: data.forum.description,
    page: (page.data as { metadata?: PageMetadata }).metadata,
  }));
  const structuredData = $derived(
    metadata.noindex ? '' : serializeStructuredData(metadata, data.forum.name, data.forum.description),
  );
</script>

<svelte:head>
  <title>{metadata.documentTitle}</title>
  <meta name="description" content={metadata.description} />
  <meta name="robots" content={metadata.robots} />
  <meta name="googlebot" content={metadata.robots} />
  <meta name="theme-color" content={themeColor(data.forumTheme)} />
  <meta name="application-name" content={data.forum.name} />
  <meta name="apple-mobile-web-app-title" content={data.forum.name} />
  <link rel="canonical" href={metadata.canonical} />
  {#if data.forumFavicon}
    <link rel="icon" href={data.forumFavicon.url} type={data.forumFavicon.mimeType} />
    <link rel="apple-touch-icon" href={data.forumFavicon.url} />
  {:else}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="icon" href="/favicon.ico" sizes="16x16 32x32" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  {/if}

  <meta property="og:site_name" content={data.forum.name} />
  <meta property="og:locale" content="en_US" />
  <meta property="og:type" content={metadata.type} />
  <meta property="og:url" content={metadata.canonical} />
  <meta property="og:title" content={metadata.title} />
  <meta property="og:description" content={metadata.description} />
  <meta property="og:image" content={metadata.image} />
  {#if metadata.image.startsWith('https://')}
    <meta property="og:image:secure_url" content={metadata.image} />
  {/if}
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={metadata.imageAlt} />
  {#if metadata.type === 'article' && metadata.publishedTime}
    <meta property="article:published_time" content={metadata.publishedTime} />
  {/if}
  {#if metadata.type === 'article' && metadata.modifiedTime}
    <meta property="article:modified_time" content={metadata.modifiedTime} />
  {/if}
  {#if metadata.type === 'article' && metadata.authorUrl}
    <meta property="article:author" content={metadata.authorUrl} />
  {/if}
  {#if metadata.type === 'profile' && metadata.profileUsername}
    <meta property="profile:username" content={metadata.profileUsername} />
  {/if}

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={metadata.title} />
  <meta name="twitter:description" content={metadata.description} />
  <meta name="twitter:image" content={metadata.image} />
  <meta name="twitter:image:alt" content={metadata.imageAlt} />

  {#if structuredData}{@html `<script type="application/ld+json">${structuredData}</script>`}{/if}
</svelte:head>

{#if appearanceCss}{@html `<style id="forum-appearance">${appearanceCss}</style>`}{/if}

{#snippet account()}
  {#if data.user}
    {#if data.membership && !data.membership.joined}
      {#if data.joinMode === 'open' || data.standing === 'accepted-undeclared'}
        <form method="POST" action="/?/join">
          <button class="atm-btn atm-btn--sm atm-account__join">{data.joinMode === 'open' ? 'join this forum' : 'finish joining'}</button>
        </form>
      {:else if data.joinMode === 'apply'}
        <a class="atm-btn atm-btn--sm atm-account__join" href="/apply">apply to join</a>
      {/if}
    {/if}
    <div class="atm-account">
      <a class="atm-userchip" href="/settings/profile" title="Edit your profile">
        <Avatar seed={data.user.did} profile={data.avatarProfile} size={36} />
        <span class="atm-userchip__name">@{data.user.handle}</span>
      </a>
      <form method="POST" action="/login?/logout">
        <button class="atm-btn atm-btn--ghost atm-btn--sm">log out</button>
      </form>
    </div>
  {:else}
    <div class="atm-account atm-account--guest">
      <a class="atm-btn atm-btn--ghost atm-btn--sm" href="/login">log in</a>
      <a class="atm-btn atm-btn--secondary atm-btn--sm" href="/register">register</a>
    </div>
  {/if}
{/snippet}

<div class="atm-page">
  <aside class="atm-sidebar" aria-label="Forum sidebar">
    <a class="atm-sidebar__brand" href="/">
      <Logo size={24} wordmark={false} />
      <span class="atm-sidebar__forum">{data.forum.name}</span>
    </a>
    <div class="atm-sidebar__scroll">
      <ForumSidebarNav
        groups={sidebarGroups}
        forumDid={data.forumDid}
        pathname={page.url.pathname}
        admin={data.admin}
        forumUnclaimed={data.forumUnclaimed}
        signedIn={!!data.user}
        unread={data.unread}
      />
    </div>
    <div class="atm-sidebar__account">
      {@render account()}
    </div>
  </aside>

<div class="atm-shell">
  <header class="atm-mobilebar">
    <button
      class="atm-sidebar-toggle"
      type="button"
      aria-label="Open navigation"
      aria-haspopup="dialog"
      onclick={(event) => sidebarDrawer?.open(event.currentTarget)}
    ><span aria-hidden="true">☰</span></button>
    <a class="atm-mobilebar__forum" href="/">{data.forum.name}</a>
    {#if data.user}
      <a class="atm-bell" class:atm-bell--unread={data.unread > 0} href="/notifications" aria-label="Notifications, {data.unread} unread">
        <svg class="atm-bell__glyph" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3z" /><path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {#if data.unread > 0}<span class="atm-bell__count">{data.unread}</span>{/if}
      </a>
    {:else}
      <a class="atm-btn atm-btn--ghost atm-btn--sm" href="/login">log in</a>
    {/if}
  </header>

  {#each data.bans as ban (ban.uri)}
    <p class="atm-notice atm-notice--danger atm-banned">
      You're banned from posting {ban.board ? 'on one board' : 'here'}{ban.until ? ` until ${new Date(ban.until).toLocaleDateString()}` : ''}.
      {#if ban.reason}Reason: {ban.reason}{/if}
      {#if data.user}<a href="/members/{data.user.did}">Details</a>{/if}
    </p>
  {/each}

  <main class="atm-main">
    {@render children()}
  </main>

  {#if data.ringSize >= 2 || !data.forum.hideCredit}
  <footer class="atm-colophon">
    {#if data.ringSize >= 2}
      <div class="atm-webring">
        <span class="atm-webring__label">find another forum?</span>
        <nav class="atm-webring__nav" aria-label="Atmosphere webring">
          <a class="atm-webring__link atm-webring__link--prev" href="/ring/prev" rel="nofollow">
            <span class="atm-webring__chevron" aria-hidden="true">‹‹</span> prev
          </a>
          <a class="atm-webring__link atm-webring__link--random" href="/ring/random" rel="nofollow">
            <span class="atm-webring__die" aria-hidden="true">⚄</span> random
          </a>
          <a class="atm-webring__link atm-webring__link--next" href="/ring/next" rel="nofollow">
            next <span class="atm-webring__chevron" aria-hidden="true">››</span>
          </a>
        </nav>
      </div>
    {/if}
    {#if !data.forum.hideCredit}
      <a class="atm-colophon__badge" href="https://github.com/keithk/atmoBB">powered by atmobb</a>
    {/if}
  </footer>
  {/if}
</div>
</div>

<ForumSidebarDrawer
    bind:this={sidebarDrawer}
    groups={sidebarGroups}
    forumDid={data.forumDid}
    forumName={data.forum.name}
    pathname={page.url.pathname}
    admin={data.admin}
    forumUnclaimed={data.forumUnclaimed}
    signedIn={!!data.user}
    unread={data.unread}
  >
    {@render account()}
  </ForumSidebarDrawer>

<style>
  @layer atmobb {
  /* Page changes fade the content panel only; the sidebar holds still. */
  :global(::view-transition-old(root)), :global(::view-transition-new(root)) { animation-duration: 140ms; }
  .atm-sidebar { view-transition-name: atm-sidebar; }
  @media (prefers-reduced-motion: reduce) {
    :global(::view-transition-group(*)), :global(::view-transition-old(*)), :global(::view-transition-new(*)) { animation: none !important; }
  }

  /* Sidebar-first shell: navigation in a fixed column, content in one panel. */
  .atm-page {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    min-width: 0;
    min-height: 100vh;
  }
  .atm-sidebar {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100vh;
  }
  .atm-sidebar__brand {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
    padding: var(--space-2) var(--space-4);
    text-decoration: none;
  }
  .atm-sidebar__brand:hover { text-decoration: none; }
  .atm-sidebar__forum {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: var(--w-bold) var(--text-md)/1.2 var(--font-display);
    color: var(--forum-header-ink);
  }
  .atm-sidebar__scroll {
    flex: 1;
    min-height: 0;
    padding: 0 var(--space-2) var(--space-4);
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  .atm-sidebar__account {
    flex: none;
    display: grid;
    gap: var(--space-2);
    margin: var(--space-2);
    padding: var(--space-2);
    background: var(--forum-surface);
    border: var(--border-hair) solid var(--forum-edge);
    border-radius: var(--radius-md);
    box-shadow: inset 0 1px 0 var(--forum-bevel), var(--shadow-sm);
  }
  .atm-account { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
  .atm-account--guest { justify-content: flex-end; }
  .atm-account__join { width: 100%; }
  .atm-shell {
    width: 100%;
    min-width: 0;
    max-width: calc(var(--page-max) + var(--space-16));
    padding: var(--space-2) var(--space-2) var(--space-8) 0;
  }
  .atm-main {
    --main-pad-x: var(--space-4);
    --main-pad-y: var(--space-4);
    min-width: 0;
    padding: var(--main-pad-y) var(--main-pad-x);
    background: var(--forum-surface);
    border: var(--border-hair) solid var(--forum-edge);
    border-radius: var(--radius-lg);
    box-shadow: inset 0 1px 0 var(--forum-bevel), var(--shadow-sm);
  }

  /* Phone-width header: the sidebar becomes a drawer behind this button. */
  .atm-mobilebar {
    display: none;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--forum-cat-bg);
    border-bottom: var(--border-solid) solid var(--forum-cat-edge);
  }
  .atm-mobilebar__forum {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: var(--w-bold) var(--text-md)/1.2 var(--font-display);
    color: var(--forum-cat-ink);
    text-decoration: none;
  }
  .atm-sidebar-toggle {
    display: grid;
    place-items: center;
    flex: none;
    width: 38px;
    height: 38px;
    padding: 0;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-md);
    background: var(--forum-surface);
    color: var(--forum-ink);
    font: var(--w-bold) 20px/1 var(--font-body);
    cursor: pointer;
  }
  .atm-sidebar-toggle:hover { color: var(--forum-link); background: var(--forum-surface-2); }
  .atm-userchip { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; text-decoration: none; border-radius: var(--radius-md); }
  .atm-userchip:hover .atm-userchip__name { color: var(--forum-ink); }
  .atm-userchip__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-handle); color: var(--forum-ink-soft); }
  .atm-bell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border-radius: var(--radius-md);
    color: var(--forum-ink-soft);
    text-decoration: none;
  }
  .atm-bell:hover { color: var(--forum-ink); text-decoration: none; }
  .atm-bell--unread { color: var(--forum-link); }
  .atm-bell__count { font: var(--type-handle); font-variant-numeric: tabular-nums; }

  .atm-colophon {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) 0 var(--space-2);
  }
  .atm-webring {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font: var(--w-regular) var(--text-xs)/1 var(--font-mono);
  }
  .atm-webring__label {
    color: var(--forum-ink-faint);
    font: var(--w-regular) var(--text-xs)/1 var(--font-body);
  }
  .atm-webring__nav {
    display: flex;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-sm);
    background: var(--forum-surface);
    box-shadow: inset 0 1px 0 var(--forum-bevel);
    overflow: hidden;
  }
  .atm-webring__link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 5px 10px;
    color: var(--forum-ink-soft);
    text-decoration: none;
    border-right: var(--border-hair) solid var(--forum-line);
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
  }
  .atm-webring__link:last-child { border-right: none; }
  .atm-webring__link:hover {
    background: var(--forum-cat-bg);
    color: var(--forum-link);
    text-decoration: none;
  }
  .atm-webring__link:active { transform: translateY(1px); }
  .atm-webring__chevron,
  .atm-webring__die {
    display: inline-block;
    transition: transform var(--dur) var(--ease);
  }
  .atm-webring__link--prev:hover .atm-webring__chevron { transform: translateX(-2px); }
  .atm-webring__link--next:hover .atm-webring__chevron { transform: translateX(2px); }
  .atm-webring__link--random:hover .atm-webring__die { transform: rotate(160deg); }
  @media (prefers-reduced-motion: reduce) {
    .atm-webring__chevron, .atm-webring__die { transition: none; }
  }
  .atm-colophon__badge {
    font: var(--w-bold) 10px/1 var(--font-pixel);
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
    padding: 5px 9px;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-sm);
    color: var(--forum-ink-soft);
    background: var(--forum-surface);
    text-decoration: none;
  }
  a.atm-colophon__badge:hover {
    color: var(--forum-link);
    border-color: var(--forum-link);
    text-decoration: none;
  }

  @media (max-width: 860px) {
    .atm-page { display: block; }
    .atm-sidebar { display: none; }
    .atm-mobilebar { display: flex; }
    .atm-shell { max-width: none; padding: 0 0 var(--space-8); }
    .atm-main { --main-pad-x: var(--space-3); --main-pad-y: var(--space-3); border-width: 0 0 var(--border-hair); border-radius: 0; box-shadow: none; }
  }
  @media (max-width: 480px) {
    .atm-webring { flex-direction: column; gap: var(--space-2); }
  }
  }
</style>
