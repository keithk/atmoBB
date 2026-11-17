<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { applyAction, enhance } from '$app/forms';
  import type { ComposeBoard } from '$lib/new-thread';
  import BoardMarker from './BoardMarker.svelte';
  import RichTextEditor from './RichTextEditor.svelte';

  let {
    boards,
    selected,
    handle,
  }: {
    boards: ComposeBoard[];
    /** The board to post in; without it the picker starts on the last board used. */
    selected?: string;
    handle: string;
  } = $props();

  const LAST_BOARD = 'atmobb:new-thread-board';
  const TITLE_MAX = 300;

  let dialog: HTMLDialogElement;
  let form: HTMLFormElement;
  let titleInput: HTMLInputElement;
  let boardSelect = $state<HTMLSelectElement>();
  let trigger: HTMLButtonElement;
  let opener: HTMLElement | null = null;

  // svelte-ignore state_referenced_locally
  let boardUri = $state(selected ?? (boards.length === 1 ? boards[0].uri : ''));
  let title = $state('');
  let body = $state('');
  let tags = $state('');
  let pollOpen = $state(false);
  // Remounts the editor, which is the only way to empty it.
  let editorKey = $state(0);
  let posting = $state(false);
  let sent = $state(false);
  let error = $state('');

  const board = $derived(boards.find((b) => b.uri === boardUri));
  const groups = $derived(
    boards.reduce<{ name: string; boards: ComposeBoard[] }[]>((acc, b) => {
      const last = acc.at(-1);
      if (last?.name === b.group) last.boards.push(b);
      else acc.push({ name: b.group, boards: [b] });
      return acc;
    }, []),
  );
  const drafted = $derived(!!(title.trim() || body.trim() || tags.trim()));
  const titleLeft = $derived(TITLE_MAX - title.length);
  const canPoll = $derived(!board?.private);

  onMount(() => {
    if (boardUri) return;
    try {
      const last = localStorage.getItem(LAST_BOARD);
      if (last && boards.some((b) => b.uri === last)) boardUri = last;
    } catch {
      // Storage can be blocked; the picker just starts empty.
    }
  });

  async function open(event?: Event) {
    // Opened from the keyboard shortcut, focus returns to the button on close.
    opener = (event?.currentTarget as HTMLElement | undefined) ?? trigger;
    error = '';
    if (!dialog.open) dialog.showModal();
    await tick();
    (board ? titleInput : boardSelect)?.focus();
  }

  function close() {
    dialog.close();
  }

  function discard() {
    title = '';
    body = '';
    tags = '';
    pollOpen = false;
    error = '';
    editorKey++;
    titleInput.focus();
  }

  function restoreFocus() {
    if (opener?.isConnected) opener.focus();
    opener = null;
  }

  // `c` opens the composer, as on most forums, unless the reader is typing.
  function shortcut(event: KeyboardEvent) {
    if (event.key !== 'c' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    open();
  }

  function submitShortcut(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  }

  const isMac = $derived(typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform));
</script>

<svelte:window onkeydown={shortcut} />

<button
  bind:this={trigger}
  type="button"
  class="atm-btn atm-btn--primary atm-btn--sm atm-newthread"
  class:atm-newthread--draft={drafted}
  aria-haspopup="dialog"
  aria-keyshortcuts="c"
  commandfor="atm-compose"
  command="show-modal"
  title={drafted ? 'Pick up your draft (c)' : 'Start a new thread (c)'}
  onclick={open}
>
  <svg class="atm-newthread__pen" viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
  {drafted ? 'continue draft' : 'new thread'}
</button>

<dialog
  bind:this={dialog}
  id="atm-compose"
  class="atm-compose"
  aria-labelledby="atm-compose-title"
  onclose={restoreFocus}
  onkeydown={submitShortcut}
  onclick={(event) => {
    if (event.target === dialog && !posting) close();
  }}
  oncancel={(event) => {
    if (posting) event.preventDefault();
  }}
>
  <form
    bind:this={form}
    class="atm-compose__sheet"
    method="POST"
    action={board ? `${board.path}?/newThread` : undefined}
    use:enhance={({ cancel }) => {
      if (!board) {
        error = 'Pick a board for your thread.';
        boardSelect?.focus();
        cancel();
        return;
      }
      posting = true;
      error = '';
      return async ({ result }) => {
        if (result.type === 'redirect') {
          sent = true;
          try {
            localStorage.setItem(LAST_BOARD, board.uri);
          } catch {
            // Remembering the board is a convenience; posting already worked.
          }
          await applyAction(result);
          return;
        }
        posting = false;
        if (result.type === 'failure') {
          error = String(result.data?.message ?? "We couldn't post your thread. Try again.");
        } else if (result.type === 'error') {
          error = result.error?.message ?? "We couldn't post your thread. Try again.";
        }
      };
    }}
  >
    <header class="atm-compose__head">
      <h2 class="atm-compose__heading" id="atm-compose-title">
        New thread
        {#if boards.length === 1 && board}
          <span class="atm-compose__in">in</span>
          <span class="atm-compose__board atm-compose__board--fixed">
            <BoardMarker color={board.color} />
            {#if board.emoji}<span aria-hidden="true">{board.emoji}</span>{/if}
            {board.name}
          </span>
        {:else}
          <label class="atm-compose__in" for="atm-compose-board">in</label>
        {/if}
      </h2>
      {#if boards.length > 1}
        <span class="atm-compose__pick" class:atm-compose__pick--chosen={board}>
          {#if board}<BoardMarker color={board.color} class="atm-compose__pick-marker" />{/if}
          <select
            bind:this={boardSelect}
            bind:value={boardUri}
            id="atm-compose-board"
            class="atm-compose__select"
            required
          >
            <option value="" disabled>choose a board</option>
            {#each groups as group}
              <optgroup label={group.name}>
                {#each group.boards as b (b.uri)}
                  <option value={b.uri} class:atm-compose__option--child={b.child}>
                    {b.child ? '↳ ' : ''}{b.emoji ? `${b.emoji} ` : ''}{b.name}{b.private ? ' · members-only' : ''}
                  </option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </span>
      {/if}
      <button class="atm-compose__close" type="button" onclick={close} disabled={posting} aria-label="Close (your draft stays here)">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </header>

    <div class="atm-compose__body">
      {#if error}
        <p class="atm-compose__error" role="alert">{error}</p>
      {/if}
      {#if board?.private}
        <p class="atm-compose__note">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Members-only board: only members will see this thread. Images and polls are off here.
        </p>
      {/if}

      <input type="hidden" name="boardName" value={board?.name ?? ''} />
      <div class="atm-compose__titlewrap">
        <input
          bind:this={titleInput}
          bind:value={title}
          class="atm-compose__title"
          name="title"
          maxlength={TITLE_MAX}
          required
          aria-label="Title"
          autocomplete="off"
          placeholder={board ? `What's happening in ${board.name}?` : 'Give your thread a title'}
        />
        {#if titleLeft <= 40}
          <span class="atm-compose__count" class:atm-compose__count--low={titleLeft <= 10} aria-live="polite">{titleLeft}</span>
        {/if}
      </div>

      <div class="atm-compose__editor">
        {#key editorKey}
          <RichTextEditor name="body" bind:value={body} placeholder="Say more. Formatting, links, and @mentions all work." allowImages={!board?.private} />
        {/key}
      </div>

      <label class="atm-compose__tags">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12V4h8l9 9-8 8z" /><circle cx="7.5" cy="8.5" r="1.2" />
        </svg>
        <span class="atm-visually-hidden">Tags</span>
        <input bind:value={tags} name="tags" autocomplete="off" placeholder="Add tags, separated by commas (optional)" />
      </label>

      {#if pollOpen && canPoll}
        <fieldset class="atm-compose__poll">
          <legend class="atm-label">Poll</legend>
          <input class="atm-input" name="pollQuestion" maxlength="300" placeholder="Question (optional; the title works too)" />
          <textarea class="atm-input" name="pollOptions" rows="4" placeholder="One option per line, 2 to 10"></textarea>
          <div class="atm-compose__pollrow">
            <label class="atm-pollfields__row"><input type="checkbox" name="pollMultiple" value="1" /> Voters can pick more than one</label>
            <label class="atm-pollfields__row">Runs for <input class="atm-input atm-pollfields__days" type="number" name="pollDays" min="0" max="365" placeholder="∞" /> days</label>
          </div>
        </fieldset>
      {/if}
    </div>

    <footer class="atm-compose__foot">
      <span class="atm-compose__identity">posting as <b>@{handle}</b></span>
      {#if canPoll}
        <button type="button" class="atm-btn atm-btn--ghost atm-btn--sm" aria-pressed={pollOpen} onclick={() => (pollOpen = !pollOpen)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M5 20V10M12 20V4M19 20v-7" />
          </svg>
          {pollOpen ? 'remove poll' : 'add poll'}
        </button>
      {/if}
      {#if drafted && !posting}
        <button type="button" class="atm-btn atm-btn--ghost atm-btn--sm" onclick={discard}>discard</button>
      {/if}
      <button class="atm-btn atm-btn--primary atm-compose__submit" class:atm-compose__submit--sent={sent} disabled={posting}>
        {#if sent}
          <svg class="atm-compose__check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
          Posted
        {:else if posting}
          <span class="atm-spinner" aria-hidden="true"></span> Posting…
        {:else}
          Post thread <kbd class="atm-compose__kbd">{isMac ? '⌘' : 'Ctrl'}↵</kbd>
        {/if}
      </button>
    </footer>
  </form>
</dialog>

<style>
  @layer atmobb {
  /* ---- Trigger ---- */
  .atm-newthread { position: relative; }
  .atm-newthread__pen { transform-origin: 20% 80%; transition: transform var(--dur-slow) var(--ease); }
  .atm-newthread:hover .atm-newthread__pen { transform: rotate(-14deg) translateY(-1px); }
  /* A dot says a draft is waiting behind the button. */
  .atm-newthread--draft::after {
    content: '';
    position: absolute;
    top: -3px;
    right: -3px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--forum-link);
    box-shadow: 0 0 0 2px var(--forum-surface);
  }

  /* ---- Dialog ---- */
  .atm-compose {
    width: min(820px, calc(100vw - 32px));
    max-width: none;
    max-height: min(calc(100dvh - 48px), 900px);
    margin: auto;
    padding: 0;
    border: 0;
    border-radius: var(--radius-xl);
    background: transparent;
    color: var(--forum-ink);
    overflow: visible;
    /* The authored moment: the sheet settles up into place as it opens. */
    opacity: 0;
    transform: translateY(14px) scale(0.985);
    transition:
      opacity var(--dur-slow) cubic-bezier(0.16, 1, 0.3, 1),
      transform 360ms cubic-bezier(0.16, 1, 0.3, 1),
      overlay var(--dur-slow) allow-discrete,
      display var(--dur-slow) allow-discrete;
  }
  .atm-compose[open] { opacity: 1; transform: none; }
  @starting-style {
    .atm-compose[open] { opacity: 0; transform: translateY(14px) scale(0.985); }
  }
  .atm-compose::backdrop {
    background: color-mix(in oklch, var(--forum-ink) 0%, transparent);
    transition:
      background var(--dur-slow) var(--ease),
      overlay var(--dur-slow) allow-discrete,
      display var(--dur-slow) allow-discrete;
  }
  .atm-compose[open]::backdrop { background: color-mix(in oklch, var(--forum-ink) 42%, transparent); }
  @starting-style {
    .atm-compose[open]::backdrop { background: color-mix(in oklch, var(--forum-ink) 0%, transparent); }
  }

  .atm-compose__sheet {
    display: flex;
    flex-direction: column;
    max-height: inherit;
    overflow: hidden;
    background: var(--forum-surface);
    border-radius: inherit;
    box-shadow: 0 2px 6px rgba(33, 28, 22, 0.08), 0 24px 64px rgba(33, 28, 22, 0.28);
  }

  /* Header mirrors the page bar: category tint, accent rule. */
  .atm-compose__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
    background: var(--forum-cat-bg);
    --focus-color: var(--forum-cat-ink);
    border-bottom: var(--border-solid) solid var(--forum-cat-edge);
    box-shadow: inset 0 1px 0 var(--forum-bevel);
  }
  .atm-compose__heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font: var(--w-bold) var(--text-md)/1.2 var(--font-display);
    letter-spacing: var(--ls-tight);
    color: var(--forum-cat-ink);
  }
  .atm-compose__in { font-weight: var(--w-regular); color: var(--forum-ink-soft); }
  .atm-compose__board--fixed { display: inline-flex; align-items: center; gap: 0.35em; }

  .atm-compose__pick {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: 0;
  }
  .atm-compose__pick :global(.atm-compose__pick-marker) {
    position: absolute;
    left: 11px;
    pointer-events: none;
    transition: background var(--dur) var(--ease);
  }
  .atm-compose__select {
    max-width: min(340px, 60vw);
    padding: 6px 30px 6px 11px;
    font: var(--w-bold) var(--text-md)/1.2 var(--font-display);
    letter-spacing: var(--ls-tight);
    color: var(--forum-cat-ink);
    background-color: var(--forum-surface);
    background-image: linear-gradient(45deg, transparent 50%, var(--forum-ink-soft) 50%),
                      linear-gradient(135deg, var(--forum-ink-soft) 50%, transparent 50%);
    background-position: calc(100% - 16px) 55%, calc(100% - 11px) 55%;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-md);
    appearance: none;
    cursor: pointer;
    text-overflow: ellipsis;
    transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
  }
  .atm-compose__pick--chosen .atm-compose__select { padding-left: 28px; }
  .atm-compose__select:hover { border-color: var(--forum-accent); }
  .atm-compose__select:focus-visible { outline: 2px solid transparent; border-color: var(--forum-accent); box-shadow: var(--focus-ring); }
  .atm-compose__select:has(option[value='']:checked) { color: var(--forum-ink-faint); }

  /* Where customizable selects ship, the board list becomes a proper panel. */
  @supports (appearance: base-select) {
    .atm-compose__select,
    .atm-compose__select::picker(select) { appearance: base-select; }
    .atm-compose__select { background-image: none; padding-right: 10px; }
    .atm-compose__select::picker-icon {
      color: var(--forum-ink-soft);
      transition: rotate var(--dur) var(--ease);
    }
    .atm-compose__select:open::picker-icon { rotate: 180deg; }
    .atm-compose__select::picker(select) {
      max-height: min(420px, 60dvh);
      margin-top: 4px;
      padding: var(--space-1);
      background: var(--forum-surface);
      border: var(--border-hair) solid var(--forum-line-strong);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      opacity: 0;
      translate: 0 -4px;
      transition: opacity var(--dur) var(--ease), translate var(--dur) var(--ease),
        overlay var(--dur) allow-discrete, display var(--dur) allow-discrete;
    }
    .atm-compose__select:open::picker(select) { opacity: 1; translate: 0 0; }
    @starting-style {
      .atm-compose__select:open::picker(select) { opacity: 0; translate: 0 -4px; }
    }
    .atm-compose__select optgroup {
      padding-top: var(--space-1);
      font: var(--w-semibold) var(--text-2xs)/1.3 var(--font-body);
      letter-spacing: var(--ls-label);
      text-transform: uppercase;
      color: var(--forum-ink-faint);
    }
    .atm-compose__select optgroup > :global(legend) { padding: var(--space-2) var(--space-2) var(--space-1); }
    .atm-compose__select option {
      padding: 7px var(--space-2);
      border-radius: var(--radius-sm);
      font: var(--type-ui);
      letter-spacing: normal;
      text-transform: none;
      color: var(--forum-ink);
    }
    .atm-compose__select option::checkmark { color: var(--forum-link); }
    .atm-compose__select option:hover,
    .atm-compose__select option:focus-visible { background: var(--forum-surface-2); outline: none; }
    .atm-compose__select option:checked { background: var(--forum-accent-soft); color: var(--forum-ink); }
    .atm-compose__select .atm-compose__option--child { padding-left: var(--space-5); }
    .atm-compose__select option[value=''] { display: none; }
  }

  .atm-compose__close {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    margin-left: auto;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--forum-ink-soft);
    cursor: pointer;
    transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  .atm-compose__close:hover { background: var(--forum-surface); color: var(--forum-ink); }
  .atm-compose__close:focus-visible { outline: 2px solid var(--focus-color); outline-offset: 1px; }

  /* ---- Body ---- */
  .atm-compose__body {
    display: grid;
    gap: var(--space-3);
    flex: 1;
    min-height: 0;
    padding: var(--space-5) var(--space-5) var(--space-4);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .atm-compose__error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--danger-bg);
    color: var(--danger-1);
    border-radius: var(--radius-md);
    font: var(--type-ui);
    animation: atm-compose-nudge 320ms var(--ease);
  }
  @keyframes atm-compose-nudge {
    20% { transform: translateX(-4px); }
    50% { transform: translateX(3px); }
    80% { transform: translateX(-1px); }
  }
  .atm-compose__note {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--forum-ink-soft);
    font: var(--type-meta);
  }

  /* The title reads like a document heading, not a form field. */
  .atm-compose__titlewrap { position: relative; }
  .atm-compose__title {
    width: 100%;
    padding: var(--space-1) 3em var(--space-2) 0;
    border: 0;
    border-bottom: var(--border-hair) solid var(--forum-line);
    border-radius: 0;
    background:
      linear-gradient(var(--forum-accent), var(--forum-accent)) left bottom / 0 2px no-repeat;
    color: var(--forum-ink);
    font: var(--w-regular) var(--text-xl)/var(--lh-snug) var(--font-display);
    letter-spacing: var(--ls-tight);
    transition: background-size var(--dur-slow) cubic-bezier(0.16, 1, 0.3, 1);
  }
  .atm-compose__title::placeholder { color: var(--forum-ink-faint); }
  .atm-compose__title:focus { outline: none; background-size: 100% 2px; }
  .atm-compose__count {
    position: absolute;
    right: 0;
    bottom: var(--space-2);
    color: var(--forum-ink-faint);
    font: var(--type-meta);
    font-variant-numeric: tabular-nums;
  }
  .atm-compose__count--low { color: var(--danger-1); font-weight: var(--w-semibold); }

  .atm-compose__editor { display: grid; gap: 0; }
  .atm-compose__editor :global(.tiptap) { min-height: clamp(160px, 28dvh, 300px); }

  .atm-compose__tags {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-1);
    color: var(--forum-ink-faint);
    border-bottom: var(--border-hair) dashed var(--forum-line);
    transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
  }
  .atm-compose__tags:focus-within { color: var(--forum-link); border-bottom-color: var(--forum-accent); border-bottom-style: solid; }
  .atm-compose__tags input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) 0;
    border: 0;
    background: transparent;
    color: var(--forum-ink);
    font: var(--type-ui);
  }
  .atm-compose__tags input::placeholder { color: var(--forum-ink-faint); }
  .atm-compose__tags input:focus { outline: none; }

  .atm-compose__poll {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-lg);
    background: var(--forum-surface-2);
    animation: atm-compose-reveal var(--dur-slow) cubic-bezier(0.16, 1, 0.3, 1);
  }
  .atm-compose__poll legend { padding: 0 var(--space-1); }
  .atm-compose__poll textarea { resize: vertical; }
  .atm-compose__pollrow { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); }
  @keyframes atm-compose-reveal {
    from { opacity: 0; transform: translateY(-4px); }
  }

  /* ---- Footer ---- */
  .atm-compose__foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    background: var(--forum-surface-2);
    border-top: var(--border-hair) solid var(--forum-line);
  }
  .atm-compose__identity {
    min-width: 0;
    margin-right: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--forum-ink-faint);
    font: var(--type-meta);
  }
  .atm-compose__identity b { color: var(--forum-ink-soft); font: var(--type-handle); }
  .atm-compose__foot .atm-btn--ghost[aria-pressed='true'] { color: var(--forum-link); background: var(--forum-accent-soft); }
  .atm-compose__submit { min-width: 148px; }
  .atm-compose__kbd {
    padding: 2px 5px;
    border-radius: var(--radius-xs);
    border: var(--border-hair) solid color-mix(in oklch, var(--forum-accent-ink) 30%, transparent);
    background: color-mix(in oklch, var(--forum-accent-ink) 8%, transparent);
    font: var(--w-semibold) var(--text-xs)/1 var(--font-mono);
  }
  .atm-compose__submit--sent { background: var(--ok-1); border-color: var(--ok-1); color: #fff; }
  .atm-compose__check path {
    stroke-dasharray: 22;
    stroke-dashoffset: 22;
    animation: atm-compose-draw 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  @keyframes atm-compose-draw { to { stroke-dashoffset: 0; } }

  .atm-visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* Phones: a full-height sheet that rises from the bottom edge. */
  @media (max-width: 640px) {
    .atm-compose {
      width: 100vw;
      max-height: calc(100dvh - 12px);
      margin: auto 0 0;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      transform: translateY(40px);
    }
    @starting-style {
      .atm-compose[open] { transform: translateY(40px); }
    }
    .atm-compose__sheet { height: calc(100dvh - 12px); }
    .atm-compose__head { padding-left: var(--space-4); }
    .atm-compose__body { padding: var(--space-4); }
    .atm-compose__foot { padding: var(--space-3) var(--space-4) max(var(--space-3), env(safe-area-inset-bottom)); }
    .atm-compose__identity { flex-basis: 100%; order: -1; }
    .atm-compose__submit { flex: 1; }
    .atm-compose__kbd { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .atm-compose,
    .atm-compose[open] { transform: none; }
    @starting-style {
      .atm-compose[open] { transform: none; }
    }
    .atm-newthread__pen,
    .atm-compose__title { transition: none; }
    .atm-newthread:hover .atm-newthread__pen { transform: none; }
    .atm-compose__error,
    .atm-compose__poll { animation: none; }
    .atm-compose__check path { animation: none; stroke-dashoffset: 0; }
  }
  }
</style>
