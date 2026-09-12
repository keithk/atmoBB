<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { BoardGroup } from '$lib/board-presentation';
  import ForumSidebarNav from './ForumSidebarNav.svelte';

  let {
    groups,
    forumDid,
    forumName,
    pathname,
    admin = false,
    forumUnclaimed = false,
  }: {
    groups: BoardGroup[];
    forumDid: string;
    forumName: string;
    pathname: string;
    admin?: boolean;
    forumUnclaimed?: boolean;
  } = $props();

  let dialog: HTMLDialogElement;
  let closeButton: HTMLButtonElement;
  let opener: HTMLElement | null = null;

  onMount(() => {
    const desktop = matchMedia('(min-width: 861px)');
    const resized = () => {
      if (desktop.matches && dialog.open) dialog.close();
    };
    desktop.addEventListener('change', resized);
    return () => desktop.removeEventListener('change', resized);
  });

  export async function open(trigger: HTMLElement) {
    opener = trigger;
    dialog.showModal();
    await tick();
    closeButton.focus();
  }

  function close() {
    dialog.close();
  }

  function restoreFocus() {
    if (opener?.isConnected) opener.focus();
    opener = null;
  }

  function containFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="atm-sidebar-drawer"
  aria-labelledby="atm-sidebar-drawer-title"
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
  onclose={restoreFocus}
  onkeydown={containFocus}
  onclick={(event) => {
    if (event.target === dialog) close();
  }}
>
  <div class="atm-sidebar-drawer__panel">
    <header class="atm-sidebar-drawer__header">
      <strong id="atm-sidebar-drawer-title">{forumName}</strong>
      <button bind:this={closeButton} class="atm-sidebar-drawer__close" type="button" onclick={close} aria-label="Close navigation">×</button>
    </header>
    <div class="atm-sidebar-drawer__scroll">
      <ForumSidebarNav
        {groups}
        {forumDid}
        {pathname}
        {admin}
        {forumUnclaimed}
        onNavigate={close}
      />
    </div>
  </div>
</dialog>

<style>
  @layer atmobb {
  .atm-sidebar-drawer {
    width: min(86vw, 340px);
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--forum-ink);
  }
  .atm-sidebar-drawer::backdrop { background: rgba(20, 18, 24, 0.46); }
  .atm-sidebar-drawer__panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--forum-surface);
    border-right: var(--border-hair) solid var(--forum-line-strong);
    box-shadow: var(--shadow-lg);
  }
  .atm-sidebar-drawer__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 58px;
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-hair) solid var(--forum-line);
    font: var(--w-bold) var(--text-md)/1.2 var(--font-display);
  }
  .atm-sidebar-drawer__close {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--forum-ink-soft);
    font: 28px/1 var(--font-body);
    cursor: pointer;
  }
  .atm-sidebar-drawer__close:hover { color: var(--forum-ink); background: var(--forum-surface-2); }
  .atm-sidebar-drawer__scroll { min-height: 0; padding: var(--space-3); overflow-y: auto; overscroll-behavior: contain; }

  @media (min-width: 861px) {
    .atm-sidebar-drawer { display: none; }
  }
  }
</style>
