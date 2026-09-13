<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import Card from '$lib/components/Card.svelte';
  import Stamp from '$lib/components/Stamp.svelte';
  import StampRow from '$lib/components/StampRow.svelte';
  import { profileHref } from '$lib/profile-card';
  import { WORN_LIMIT } from '$lib/stamps';
  import type { TrayEntry } from '$lib/server/appview';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { message?: string; wear?: string[] } | null } = $props();

  const saved = $derived(page.url.searchParams.has('saved'));
  const pending = $derived(page.url.searchParams.has('pending'));
  const byId = $derived(new Map(data.tray.map((entry) => [entry.id, entry])));
  // A rejected submission comes back as sent; otherwise the appview's answer.
  const initial = $derived((form?.wear ?? data.worn).filter((id) => byId.has(id)));
  // Ticked ids in DOM order, worn first: with JS the preview follows the boxes.
  // Seeded for the server render, then kept in step when a save lands new data.
  let selected = $state(untrack(() => initial));
  $effect(() => {
    selected = initial;
  });

  const worn = $derived(initial.flatMap((id) => byId.get(id) ?? []));
  const rest = $derived(data.tray.filter((entry) => !initial.includes(entry.id)));
  const preview = $derived(selected.flatMap((id) => byId.get(id) ?? []));
  const over = $derived(selected.length - WORN_LIMIT);

  const groups: { title: string; note: string; sources: string[]; entries: TrayEntry[] }[] = $derived([
    {
      title: 'Stamps this forum gave you',
      note: 'Made by the admins here and earned, or given to you by hand.',
      sources: ['admin', 'byHand'],
      entries: rest.filter((entry) => entry.source === 'admin' || entry.source === 'byHand'),
    },
    {
      title: "Where you've been",
      note: 'Your first post in a board, and how you arrived.',
      sources: ['default'],
      entries: rest.filter((entry) => entry.source === 'default'),
    },
    {
      title: 'Across the atmosphere',
      note: 'Stamps every atmoBB forum recognizes; they follow your account.',
      sources: ['network'],
      entries: rest.filter((entry) => entry.source === 'network'),
    },
  ]);
  const groupOf = (entry: TrayEntry) => groups.find((g) => g.sources.includes(entry.source))?.title ?? '';
</script>

<div class="wrap">
  <nav class="atm-crumbs">
    <a href={profileHref(data.did)}>your profile</a><span class="atm-crumbs__sep">›</span>
    <span class="atm-crumbs__current">stamps</span>
  </nav>

  <h1 class="title">Your stamps</h1>
  <p class="lede">
    Pick up to {WORN_LIMIT} to wear beside your name on this forum, and put them in the order you like.
    New stamps land in your tray but aren't worn until you choose them.
  </p>

  {#if pending}
    <p class="atm-ok">Saved. The change is taking a few extra seconds to show up here — refresh to see it.</p>
  {:else if saved}
    <p class="atm-ok">Saved.</p>
  {/if}

  {#if data.tray.length === 0}
    <Card title="Nothing in your tray yet">
      <p class="atm-empty atm-empty--bare">Post in a board or two and your first stamps will turn up here.</p>
    </Card>
  {:else}
    <form method="POST" action="?/save" class="tray" use:enhance>
      <Card title="Wearing">
        <div class="preview" aria-live="polite">
          <span class="atm-eyebrow">On your rail</span>
          {#if preview.length}
            <StampRow stamps={preview} handles={data.handles} />
          {:else}
            <span class="atm-hint">Nothing yet. Tick a stamp below.</span>
          {/if}
        </div>
        {#if form?.message}
          <p class="atm-err" role="alert">{form.message}</p>
        {:else if over > 0}
          <p class="atm-err" role="alert">You can wear up to {WORN_LIMIT} stamps. Untick {over} to save.</p>
        {/if}
        {#if worn.length}
          <ul class="rows">
            {#each worn as entry, i (entry.id)}
              <li class="row">
                <span class="row__move">
                  <button class="row__btn" formaction="?/move" name="move" value="up:{entry.id}" disabled={i === 0} aria-label="Move {entry.name} up">↑</button>
                  <button class="row__btn" formaction="?/move" name="move" value="down:{entry.id}" disabled={i === worn.length - 1} aria-label="Move {entry.name} down">↓</button>
                </span>
                <label class="row__pick">
                  <input type="checkbox" name="wear" value={entry.id} bind:group={selected} />
                  <Stamp {entry} handles={data.handles} />
                  <span class="row__from">{groupOf(entry)}</span>
                </label>
              </li>
            {/each}
          </ul>
          <p class="atm-hint">Untick a stamp to take it off. The order here is the order on your rail.</p>
        {:else}
          <p class="atm-hint">You're not wearing any stamps. Tick up to {WORN_LIMIT} below.</p>
        {/if}
      </Card>

      {#each groups as group (group.title)}
        <Card title={group.title}>
          <p class="note">{group.note}</p>
          {#if group.entries.length}
            <ul class="rows">
              {#each group.entries as entry (entry.id)}
                <li class="row">
                  <label class="row__pick">
                    <input type="checkbox" name="wear" value={entry.id} bind:group={selected} />
                    <Stamp {entry} handles={data.handles} />
                  </label>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="atm-empty atm-empty--bare">
              {group.sources.includes('default') && worn.length ? 'All worn.' : 'None yet.'}
            </p>
          {/if}
        </Card>
      {/each}

      <div class="actions">
        <span class="atm-hint status">Saved to your account, for this forum only.</span>
        <a class="atm-btn atm-btn--ghost" href={profileHref(data.did)}>Cancel</a>
        <button class="atm-btn atm-btn--primary" disabled={over > 0}>Save</button>
      </div>
    </form>
  {/if}
</div>

<style>
  @layer atmobb {
  .wrap { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); }
  .title { font: var(--type-page-title); color: var(--forum-ink); margin: 0; }
  .lede, .note { margin: 0; font: var(--type-meta); color: var(--forum-ink-soft); }
  .note { margin-bottom: var(--space-3); }

  .tray { display: flex; flex-direction: column; gap: var(--space-4); }

  .preview {
    display: flex; flex-direction: column; gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-3);
    background: var(--forum-surface-2);
    border: 1px dashed var(--forum-line-strong);
    border-radius: var(--radius-md);
  }

  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .row { display: flex; align-items: center; gap: var(--space-2); }
  .row__pick {
    flex: 1; min-width: 0;
    display: flex; align-items: center; gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
    background: var(--forum-surface);
    cursor: pointer;
  }
  .row__pick:has(input:checked) { border-color: var(--forum-line-strong); background: var(--forum-surface-2); }
  .row__from { margin-left: auto; font: var(--type-meta); color: var(--forum-ink-faint); }

  .row__move { display: flex; flex-direction: column; gap: 2px; }
  .row__btn {
    font: var(--type-meta);
    line-height: 1;
    padding: 3px 6px;
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
    background: var(--forum-surface-2);
    color: var(--forum-ink-soft);
    cursor: pointer;
  }
  .row__btn:hover:not(:disabled) { color: var(--forum-ink); background: var(--forum-surface-1); }
  .row__btn:disabled { opacity: 0.35; cursor: default; }

  .actions {
    display: flex; align-items: center; gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: var(--border-hair) solid var(--forum-line);
  }
  .status { margin-right: auto; }

  @media (max-width: 560px) {
    .row__from { display: none; }
  }
  }
</style>
