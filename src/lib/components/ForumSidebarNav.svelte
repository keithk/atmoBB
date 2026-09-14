<script lang="ts">
  import { boardPath } from '$lib/appview-paths';
  import type { BoardGroup } from '$lib/board-presentation';
  import BoardLabel from './BoardLabel.svelte';

  let {
    groups,
    forumDid,
    pathname,
    admin = false,
    forumUnclaimed = false,
    onNavigate,
  }: {
    groups: BoardGroup[];
    forumDid: string;
    pathname: string;
    admin?: boolean;
    forumUnclaimed?: boolean;
    onNavigate?: () => void;
  } = $props();

  const links = [
    { label: 'Home', href: '/', icon: 'M3 10 12 3l9 7v11h-7v-7h-4v7H3Z' },
    { label: 'Latest', href: '/latest', icon: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2' },
    { label: 'Members', href: '/members', icon: 'M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M3 21v-2a6 6 0 0 1 12 0v2M18 3a4 4 0 0 1 0 8M21 21v-2a6 6 0 0 0-3-5.2' },
    { label: 'Rules', href: '/rules', icon: 'M14 2H5v20h14V7ZM14 2v5h5M8 12h8M8 16h8' },
  ];
  const lockIcon = 'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3';
  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
</script>

{#snippet icon(path: string)}
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
{/snippet}

<nav class="atm-sidebar-nav" aria-label="Forum navigation">
  <ul class="atm-sidebar-nav__primary">
    {#each links as link}
      <li>
        <a
          class:atm-sidebar-nav__link--active={active(link.href)}
          class="atm-sidebar-nav__link"
          href={link.href}
          aria-current={active(link.href) ? 'page' : undefined}
          onclick={onNavigate}
        >
          <span class="atm-sidebar-nav__icon">{@render icon(link.icon)}</span>
          {link.label}
        </a>
      </li>
    {/each}
    {#if admin || forumUnclaimed}
      <li>
        <a
          class:atm-sidebar-nav__link--active={active('/admin')}
          class="atm-sidebar-nav__link"
          href="/admin"
          aria-current={active('/admin') ? 'page' : undefined}
          onclick={onNavigate}
        >
          <span class="atm-sidebar-nav__icon">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m9 3-.5 2.5-2 1.2L4 6l-2 3.5 2 1.7v2L2 15l2 3.5 2.5-.7 2 1.2L9 22h6l.5-3 2-1.2 2.5.7 2-3.5-2-1.8v-2l2-1.7L20 6l-2.5.7-2-1.2L15 3Z" />
              <circle cx="12" cy="12.5" r="3" />
            </svg>
          </span>
          {admin ? 'Admin' : 'Set up this forum'}
        </a>
      </li>
    {/if}
  </ul>

  <div class="atm-sidebar-nav__boards" aria-label="Boards">
    {#each groups as group}
      <section class="atm-sidebar-nav__group">
        <h2 class="atm-sidebar-nav__heading">{group.name}</h2>
        <ul>
          {#each group.boards as board}
            {@const href = boardPath(board.uri, forumDid)}
            <li>
              <a
                class:atm-sidebar-nav__link--active={active(href)}
                class="atm-sidebar-nav__link atm-sidebar-nav__board"
                href={href}
                aria-current={active(href) ? 'page' : undefined}
                onclick={onNavigate}
              >
                <span class="atm-sidebar-nav__label"><BoardLabel board={board.value} /></span>
                {#if board.value.access?.space}<span class="atm-sidebar-nav__lock" role="img" aria-label="Members only">{@render icon(lockIcon)}</span>{/if}
              </a>
            </li>
            {#each board.children as child}
              {@const childHref = boardPath(child.uri, forumDid)}
              <li>
                <a
                  class:atm-sidebar-nav__link--active={active(childHref)}
                  class="atm-sidebar-nav__link atm-sidebar-nav__board atm-sidebar-nav__board--child"
                  href={childHref}
                  aria-current={active(childHref) ? 'page' : undefined}
                  onclick={onNavigate}
                >
                  <span class="atm-sidebar-nav__label"><BoardLabel board={child.value} /></span>
                  {#if child.value.access?.space}<span class="atm-sidebar-nav__lock" role="img" aria-label="Members only">{@render icon(lockIcon)}</span>{/if}
                </a>
              </li>
            {/each}
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</nav>

<style>
  @layer atmobb {
  .atm-sidebar-nav { min-height: 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  .atm-sidebar-nav__primary {
    padding-bottom: var(--space-3);
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .atm-sidebar-nav__link {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 38px;
    padding: 7px var(--space-3);
    border-radius: var(--radius-md);
    color: var(--forum-ink);
    font: var(--w-semibold) var(--text-sm)/1.25 var(--font-body);
    text-decoration: none;
  }
  .atm-sidebar-nav__link:hover {
    color: var(--forum-link);
    background: var(--forum-surface-2);
    text-decoration: none;
  }
  .atm-sidebar-nav__link--active {
    color: var(--forum-link);
    background: var(--forum-accent-soft);
  }
  .atm-sidebar-nav__icon { display: flex; justify-content: center; width: 18px; flex: none; color: var(--forum-ink-soft); }
  .atm-sidebar-nav__link:hover .atm-sidebar-nav__icon,
  .atm-sidebar-nav__link--active .atm-sidebar-nav__icon { color: inherit; }
  .atm-sidebar-nav__boards { padding-top: var(--space-3); }
  .atm-sidebar-nav__group + .atm-sidebar-nav__group { margin-top: var(--space-3); }
  .atm-sidebar-nav__heading {
    margin: 0;
    padding: 5px var(--space-3);
    color: var(--forum-ink-faint);
    font: var(--w-bold) var(--text-xs)/1.25 var(--font-body);
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
  }
  .atm-sidebar-nav__board { font-weight: var(--w-medium); }
  .atm-sidebar-nav__board--child { padding-left: calc(var(--space-3) + 1.25em); font-size: var(--text-xs); }
  .atm-sidebar-nav__label { min-width: 0; overflow-wrap: anywhere; }
  .atm-sidebar-nav__lock { display: flex; flex: none; margin-left: auto; color: var(--forum-ink-soft); }
  }
</style>
