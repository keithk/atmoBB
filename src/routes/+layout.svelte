<script lang="ts">
  import '$lib/styles/index.css';
  import { page } from '$app/state';
  import Logo from '$lib/components/Logo.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { resolveMetadata, serializeStructuredData, type PageMetadata } from '$lib/seo';

  let { data, children } = $props();

  const tabs = [
    { label: 'Boards', href: '/' },
    { label: 'Latest', href: '/latest' },
    { label: 'Members', href: '/members' },
    { label: 'Rules', href: '/rules' },
  ];
  const isActive = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

  const appearanceCss = $derived(
    data.forumFontCss + (page.url.pathname.startsWith('/admin') ? '' : `\n${data.forumCustomCss}`),
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
  <meta name="application-name" content={data.forum.name} />
  <meta name="apple-mobile-web-app-title" content={data.forum.name} />
  <link rel="canonical" href={metadata.canonical} />

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

<div class="atm-shell">
  <header class="atm-masthead">
    <div class="atm-masthead__bar">
      <a class="atm-masthead__brand" href="/">
        <Logo size={24} />
        <span class="atm-masthead__slash" aria-hidden="true">/</span>
        <span class="atm-masthead__forum">{data.forum.name}</span>
      </a>
      <div class="atm-masthead__right">
        {#if data.user}
          {#if data.membership && !data.membership.joined}
            <form method="POST" action="/?/join">
              <button class="atm-btn atm-btn--sm">join this forum</button>
            </form>
          {/if}
          <a class="atm-userchip" href="/settings/profile" title="Edit your profile">
            <Avatar seed={data.user.did} profile={data.avatarProfile} size={48} />
            <span class="atm-userchip__name">@{data.user.handle}</span>
          </a>
          <form method="POST" action="/login?/logout">
            <button class="atm-btn atm-btn--ghost atm-btn--sm">log out</button>
          </form>
        {:else}
          <a class="atm-btn atm-btn--ghost atm-btn--sm" href="/login">log in</a>
          <a class="atm-btn atm-btn--secondary atm-btn--sm" href="/register">register</a>
        {/if}
      </div>
    </div>

    <div class="atm-masthead__hero">
      <div class="atm-masthead__name">{data.forum.name}</div>
      {#if data.forum.description}
        <div class="atm-masthead__tagline">{data.forum.description}</div>
      {/if}
      <code class="atm-masthead__handle">{data.forumDid}</code>
    </div>

    <nav class="atm-mastnav" aria-label="Forum">
      {#each tabs as tab}
        <a class="atm-mastnav__item {isActive(tab.href) ? 'atm-mastnav__item--active' : ''}" href={tab.href}
          aria-current={isActive(tab.href) ? 'page' : undefined}>{tab.label}</a>
      {/each}
      <span class="atm-mastnav__spacer"></span>
      {#if data.admin || data.forumUnclaimed}
        <a class="atm-mastnav__item {isActive('/admin') ? 'atm-mastnav__item--active' : ''}" href="/admin"
          aria-current={isActive('/admin') ? 'page' : undefined}>{data.admin ? 'Admin' : 'Set up this forum'}</a>
      {/if}
    </nav>
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
    <a class="atm-colophon__badge" href="https://github.com/keithk/atmoBB">powered by atmobb</a>
  </footer>
</div>

<style>
  @layer atmobb {
  .atm-shell {
    max-width: var(--page-max);
    margin: 0 auto;
    padding: var(--space-4) var(--space-4) var(--space-8);
  }

  .atm-masthead {
    background: var(--forum-header-bg);
    border: var(--border-hair) solid var(--forum-edge);
    border-radius: var(--radius-lg);
    box-shadow: inset 0 1px 0 var(--forum-bevel), var(--shadow-sm);
    overflow: hidden;
    margin-bottom: var(--space-5);
  }

  .atm-masthead__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .atm-masthead__brand {
    display: inline-flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
  }
  .atm-masthead__brand:hover { text-decoration: none; }
  .atm-masthead__slash { color: var(--forum-ink-faint); font: var(--w-regular) var(--text-lg)/1 var(--font-display); }
  .atm-masthead__forum {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: var(--w-bold) var(--text-md)/1 var(--font-display);
    color: var(--forum-header-ink);
  }
  .atm-masthead__right { display: flex; flex: none; align-items: center; gap: var(--space-3); }
  .atm-userchip { display: inline-flex; align-items: center; gap: var(--space-2); text-decoration: none; border-radius: var(--radius-md); }
  .atm-userchip:hover .atm-userchip__name { color: var(--forum-ink); }
  .atm-userchip__name { font: var(--type-handle); color: var(--forum-ink-soft); }

  .atm-masthead__hero {
    padding: var(--space-6) var(--space-5) var(--space-5);
  }
  .atm-masthead__name {
    font: var(--type-masthead);
    letter-spacing: var(--ls-tight);
    color: var(--forum-header-ink);
  }
  .atm-masthead__tagline {
    font: var(--type-ui);
    color: var(--forum-ink-soft);
    margin-top: var(--space-1);
    max-width: 70ch;
  }
  .atm-masthead__handle {
    display: inline-block;
    margin-top: var(--space-2);
    font: var(--type-handle);
    color: var(--forum-ink-faint);
  }

  .atm-mastnav {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    background: var(--forum-cat-bg);
    border-top: var(--border-hair) solid var(--forum-line);
    box-shadow: inset 0 1px 0 var(--forum-bevel);
  }
  .atm-mastnav__item {
    padding: 10px 14px 8px;
    font: var(--w-semibold) var(--text-sm)/1 var(--font-body);
    color: var(--forum-cat-ink);
    text-decoration: none;
    border-bottom: var(--border-solid) solid transparent;
    transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
  }
  .atm-mastnav__item:hover { color: var(--forum-link); text-decoration: none; }
  .atm-mastnav__item--active {
    color: var(--forum-ink);
    border-bottom-color: var(--forum-cat-edge);
  }
  .atm-mastnav__spacer { flex: 1; }

  .atm-colophon {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6) 0 var(--space-2);
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

  @media (max-width: 720px) {
    .atm-masthead__hero { padding: var(--space-4); }
    .atm-masthead__name { font: var(--w-regular) var(--text-2xl)/var(--lh-tight) var(--font-display); }
  }
  @media (max-width: 480px) {
    .atm-mastnav { gap: 0; padding-inline: var(--space-1); }
    .atm-mastnav__item { padding-inline: 9px; }
    .atm-masthead__right { gap: var(--space-2); }
    .atm-userchip__name { display: none; }
    .atm-webring { flex-direction: column; gap: var(--space-2); }
  }
  }
</style>
