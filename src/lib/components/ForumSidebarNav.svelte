<script lang="ts">
  import { boardPath } from '$lib/appview-paths';
  import type { BoardGroup } from '$lib/board-presentation';
  import BoardMarker from './BoardMarker.svelte';

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
    { label: 'Home', href: '/', icon: '⌂' },
    { label: 'Latest', href: '/latest', icon: '◷' },
    { label: 'Members', href: '/members', icon: '♙' },
    { label: 'Rules', href: '/rules', icon: '§' },
  ];
  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
</script>

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
          <span class="atm-sidebar-nav__icon" aria-hidden="true">{link.icon}</span>
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
          <span class="atm-sidebar-nav__icon" aria-hidden="true">⚙</span>
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
                <BoardMarker color={board.value.color} />
                <span class="atm-sidebar-nav__label">{board.value.name}</span>
                {#if board.value.access?.space}<span class="atm-sidebar-nav__lock" aria-label="Members only">🔒</span>{/if}
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
                  <BoardMarker color={child.value.color} />
                  <span class="atm-sidebar-nav__label">{child.value.name}</span>
                  {#if child.value.access?.space}<span class="atm-sidebar-nav__lock" aria-label="Members only">🔒</span>{/if}
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
  .atm-sidebar-nav__icon { width: 1.25em; color: var(--forum-ink-faint); text-align: center; }
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
  .atm-sidebar-nav__lock { margin-left: auto; color: var(--forum-ink-faint); font-size: 0.75em; }
  }
</style>
