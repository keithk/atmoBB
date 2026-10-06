<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import type { TrayEntry } from '$lib/server/appview';
  import { WORN_LIMIT, moveStamp, stampDescription, stampLabel, stampOrigin, type Handles } from '$lib/stamps';
  import Stamp from './Stamp.svelte';
  import StampRow from './StampRow.svelte';

  let { tray, worn, handles = {}, handle, form = null, saved = false, pending = false }: {
    tray: TrayEntry[];
    worn: string[];
    handles?: Handles;
    handle: string;
    form?: { message?: string; wear?: string[] } | null;
    saved?: boolean;
    pending?: boolean;
  } = $props();

  const byId = $derived(new Map(tray.map((entry) => [entry.id, entry])));
  const initial = $derived([...new Set(form?.wear ?? worn)].filter((id) => byId.has(id)));
  let selected = $state(untrack(() => initial));
  let saving = $state(false);
  $effect(() => { selected = initial; });
  const preview = $derived(selected.flatMap((id) => byId.get(id) ?? []));
  const over = $derived(selected.length > WORN_LIMIT);
  const dirty = $derived(selected.length !== worn.length || selected.some((id, i) => id !== worn[i]));

  function toggle(event: MouseEvent, id: string) {
    event.preventDefault();
    selected = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
  }

  function move(event: MouseEvent, value: string) {
    event.preventDefault();
    selected = moveStamp(selected, value);
  }
</script>

<div class="collection-page">
  <header class="intro">
    <h1>Your stamps</h1>
    <p>Little keepsakes from your time here. Choose up to {WORN_LIMIT} to wear beside your name.</p>
  </header>

  {#if pending}
    <p class="atm-ok" role="status">Saved. Your changes are still being indexed. Refresh in a few seconds to see them.</p>
  {:else if saved && !dirty}
    <p class="atm-ok" role="status">Your stamps are saved.</p>
  {/if}

  {#if !tray.length}
    <section class="empty">
      <h2>Your collection starts here</h2>
      <p>Make a first post in a public board to earn a stamp. This forum may also award its own.</p>
      <a class="atm-btn atm-btn--secondary" href="/">Explore the forum</a>
    </section>
  {:else}
    <div class="collection-layout">
      <form method="POST" action="?/save" class="editor" use:enhance={() => {
        saving = true;
        return async ({ update }) => {
          try { await update({ reset: false }); } finally { saving = false; }
        };
      }}>
        <fieldset disabled={saving}>
          {#each selected as id (id)}<input type="hidden" name="wear" value={id} />{/each}
          <section class="wearing" aria-labelledby="wearing-title">
            <div class="section-heading">
              <h2 id="wearing-title">Currently wearing</h2>
              <span class="count" aria-live="polite">{selected.length} of {WORN_LIMIT}</span>
            </div>
            <p class="hint">Shown on this forum, in this order. Move stamps to arrange your row.</p>
            <ol class="slots">
              {#each preview as entry, i (entry.id)}
                {@const label = stampLabel(entry, handles)}
                <li class="slot">
                  <span class="slot__face"><span class="slot__number">{i + 1}</span><Stamp {entry} {handles} size="compact" /></span>
                  <span class="slot__name">{label}</span>
                  <span class="slot__controls">
                    <button class="move" formaction="?/move" name="move" value="up:{entry.id}" disabled={i === 0}
                      aria-label="Move {label} earlier" onclick={(event) => move(event, `up:${entry.id}`)}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9 4-4 4 4 4" /></svg>
                    </button>
                    <button class="move" formaction="?/move" name="move" value="down:{entry.id}" disabled={i === preview.length - 1}
                      aria-label="Move {label} later" onclick={(event) => move(event, `down:${entry.id}`)}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m7 4 4 4-4 4" /></svg>
                    </button>
                  </span>
                </li>
              {/each}
              {#if selected.length < WORN_LIMIT}
                <li class="slot slot--empty">{WORN_LIMIT - selected.length} {WORN_LIMIT - selected.length === 1 ? 'spot' : 'spots'} open</li>
              {/if}
            </ol>
            {#if !selected.length}<p class="hint">Nothing worn. Choose a stamp below, or save an empty row.</p>{/if}
            <noscript><p class="hint">Without JavaScript, each Wear, Take off, or move button saves immediately.</p></noscript>
          </section>

          <section class="collection" aria-labelledby="collection-title">
            <div class="section-heading">
              <h2 id="collection-title">Your collection</h2>
              <span class="count">{tray.length} {tray.length === 1 ? 'stamp' : 'stamps'}</span>
            </div>
            <ul class="entries">
              {#each tray as entry (entry.id)}
                {@const position = selected.indexOf(entry.id)}
                {@const label = stampLabel(entry, handles)}
                <li class="entry">
                  <div class="entry__face"><Stamp {entry} {handles} size="compact" /></div>
                  <div class="entry__copy">
                    <h3>{label}</h3>
                    <p>{stampDescription(entry, handles)}</p>
                    <small>{stampOrigin(entry)}</small>
                  </div>
                  <div class="entry__action">
                    {#if position !== -1}<span class="wearing-label">Wearing · {position + 1}</span>{/if}
                    <button class="atm-btn atm-btn--secondary atm-btn--sm"
                      formaction="?/toggle" name="toggle" value={entry.id}
                      aria-label="{position !== -1 ? 'Take off' : 'Wear'} {label}"
                      disabled={position === -1 && selected.length >= WORN_LIMIT}
                      onclick={(event) => toggle(event, entry.id)}>
                      {position !== -1 ? 'Take off' : 'Wear stamp'}
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
            {#if selected.length >= WORN_LIMIT}<p class="hint">All {WORN_LIMIT} spots are filled. Take one off to make room for another.</p>{/if}
          </section>

          <footer class="actions">
            {#if form?.message}<p class="atm-err" role="alert">{form.message}</p>{/if}
            {#if over}<p class="atm-err" role="alert">Take off {selected.length - WORN_LIMIT} stamps before saving.</p>{/if}
            <p class="hint">Taking a stamp off keeps it in your collection.</p>
            <div class="actions__buttons">
              <span class="hint" aria-live="polite">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved to this forum only'}</span>
              <button class="atm-btn atm-btn--primary" disabled={over}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </footer>
        </fieldset>
      </form>

      <aside class="preview" aria-label="Stamp preview">
        <h2>Beside your name</h2>
        <p class="hint">The same stamps, a little quieter. Your name and words still come first.</p>
        <div class="preview__sample">
          <strong>@{handle}</strong>
          {#if preview.length}<StampRow stamps={preview} {handles} />{:else}<p class="hint">No stamps displayed.</p>{/if}
        </div>
        <p class="hint">Tap a stamp to learn what it means. You can also reach it with Tab and open it with Enter.</p>
        <p class="hint">Each stamp has its own fixed letter or emoji. Put yours in any order you like.</p>
      </aside>
    </div>
  {/if}
</div>

<style>
  @layer atmobb {
    .collection-page { width: 100%; max-width: 1040px; margin: 0 auto; }
    .intro { margin-bottom: var(--space-6); }
    .intro h1 { margin: 0 0 var(--space-2); }
    .intro p { color: var(--forum-ink-soft); max-width: 65ch; }
    h2 { font: var(--type-board-title); margin: 0; }
    .hint, .count { font: var(--type-meta); color: var(--forum-ink-soft); margin: 0; }
    .collection-layout { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: var(--space-6); align-items: start; }
    .editor { min-width: 0; border: var(--border-hair) solid var(--forum-line-strong); border-radius: var(--radius-lg); background: var(--forum-surface); overflow: hidden; }
    fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    .wearing, .collection, .actions { padding: var(--space-5); }
    .wearing { background: var(--forum-surface-2); border-bottom: var(--border-hair) solid var(--forum-line); }
    .section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-2); }
    .count { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .slots { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-4) 0 0; padding: 0; list-style: none; }
    .slot { width: 82px; min-height: 112px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2); border: var(--border-hair) solid var(--forum-line-strong); border-radius: var(--radius-sm); background: var(--forum-surface); }
    .slot__face { display: flex; gap: 6px; align-items: center; }
    .slot__number { font: var(--type-meta); color: var(--forum-ink-soft); }
    .slot__name { width: 100%; font: var(--type-meta); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
    .slot__controls { display: flex; }
    .move { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: var(--border-hair) solid var(--forum-line); background: var(--forum-surface-2); color: var(--forum-ink); cursor: pointer; }
    .move:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
    .move:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; border-left: 0; }
    .move svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 1.5; fill: none; }
    .move:disabled { opacity: .4; cursor: default; }
    .move:hover:not(:disabled) { background: var(--forum-surface-1); }
    .slot--empty { justify-content: center; border-style: dashed; background: transparent; color: var(--forum-ink-soft); font: var(--type-meta); text-align: center; }
    .wearing > .hint:last-child { margin-top: var(--space-3); }
    .entries { margin: var(--space-2) 0 0; padding: 0; list-style: none; }
    .entry { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; padding: var(--space-5) 0; border-top: var(--border-hair) solid var(--forum-line); }
    .entry:first-child { border-top: 0; }
    .entry__face { align-self: start; padding-top: 2px; }
    .entry__copy { overflow-wrap: anywhere; }
    .entry h3 { font: var(--type-ui); margin: 0 0 var(--space-1); }
    .entry p { font: var(--type-meta); color: var(--forum-ink-soft); margin: 0 0 var(--space-1); }
    .entry small { font: var(--type-meta); color: var(--forum-ink-soft); }
    .entry__action { display: grid; justify-items: end; gap: var(--space-2); }
    .wearing-label { font: var(--type-meta); color: var(--forum-rank); }
    .actions { border-top: var(--border-hair) solid var(--forum-line); display: grid; gap: var(--space-3); }
    .actions__buttons { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
    .preview { display: grid; gap: var(--space-3); min-width: 0; }
    .preview__sample { display: grid; justify-items: start; gap: var(--space-3); padding: var(--space-4); border: var(--border-hair) solid var(--forum-line-strong); border-radius: var(--radius-md); background: var(--forum-surface); }
    .preview__sample strong { font: var(--type-ui); overflow-wrap: anywhere; max-width: 100%; }
    .empty { padding: var(--space-6); background: var(--forum-surface); border: var(--border-hair) solid var(--forum-line); border-radius: var(--radius-lg); }
    .empty h2 { margin-bottom: var(--space-2); }
    .empty p { color: var(--forum-ink-soft); }
    @media (max-width: 820px) {
      .collection-layout { grid-template-columns: minmax(0, 1fr); }
      .preview { grid-row: 1; }
      .preview__sample { padding: var(--space-3); }
      .preview > .hint:last-child { display: none; }
    }
    @media (max-width: 480px) {
      .wearing, .collection, .actions { padding: var(--space-4); }
      .entry { grid-template-columns: 24px minmax(0, 1fr); gap: var(--space-2); }
      .entry__action { grid-column: 2; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; }
      .slot { width: 76px; }
    }
  }
</style>
