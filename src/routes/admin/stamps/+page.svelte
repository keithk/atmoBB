<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Stamp from '$lib/components/Stamp.svelte';
  import StampPreview from '$lib/components/StampPreview.svelte';
  import { normalizeBoardColor } from '$lib/board-presentation';
  import {
    ARRIVAL_ROUTES,
    LOW_CONTRAST,
    STAMP_NAME_MAX_GRAPHEMES,
    STAMP_SHAPES,
    TRIGGER_KINDS,
    TRIGGER_KIND_LABELS,
    contrastRatio,
    isLowContrast,
    parseLook,
    type StampLook,
  } from '$lib/stamps';

  let { data, form } = $props();

  type StampData = (typeof data.stamps)[number];

  const saved = $derived(page.url.searchParams.get('saved'));
  const pending = $derived(page.url.searchParams.has('pending'));

  // Palettes an admin can pick from the color fields; free hex still works.
  const PRESETS = [
    { label: 'Coral', bg: '#f79b7a', ink: '#4a2a1c' },
    { label: 'Sky', bg: '#3b82f6', ink: '#ffffff' },
    { label: 'Lemon', bg: '#fff3c4', ink: '#5b4300' },
    { label: 'Lavender', bg: '#e4e0ff', ink: '#2b1f6b' },
    { label: 'Moss', bg: '#79a85a', ink: '#15260f' },
    { label: 'Bubblegum', bg: '#f472b6', ink: '#4a1631' },
    { label: 'Midnight', bg: '#1b1c26', ink: '#ffb454' },
  ];
  const NEW_LOOK: StampLook = { bg: PRESETS[2].bg, ink: PRESETS[2].ink, shape: 'stamp' };

  const ROUTE_LABELS: Record<(typeof ARRIVAL_ROUTES)[number], string> = {
    invite: 'brought in by invite',
    application: 'accepted by application',
    founding: 'founding member',
  };

  interface Draft {
    name: string;
    bg: string;
    ink: string;
    shape: string;
    kind: string;
    board: string;
    before: string;
    via: string;
    /** The last look that parsed, so the preview holds still while a field is mid-edit. */
    look: StampLook;
  }

  // Edits keyed by stamp uri ('new' for the create form). A form that came back
  // rejected refills from what was sent; otherwise from the record.
  let drafts = $state<Record<string, Draft>>({});

  function initialDraft(uri: string, stamp: StampData | null): Draft {
    const sent = form?.uri === uri ? form.fields : undefined;
    const fields = sent ?? {
      name: stamp?.name ?? '',
      bg: stamp?.look?.bg ?? NEW_LOOK.bg,
      ink: stamp?.look?.ink ?? NEW_LOOK.ink,
      shape: stamp?.look?.shape ?? NEW_LOOK.shape,
      kind: stamp?.trigger.kind ?? 'byHand',
      board: stamp?.trigger.board ?? '',
      before: (stamp?.trigger.before ?? '').slice(0, 10),
      via: stamp?.trigger.via ?? '',
    };
    return { ...fields, look: parseLook(fields) ?? stamp?.look ?? NEW_LOOK };
  }

  const draftFor = (uri: string, stamp: StampData | null) => drafts[uri] ?? initialDraft(uri, stamp);

  function edit(uri: string, stamp: StampData | null, patch: Partial<Draft>) {
    const next = { ...draftFor(uri, stamp), ...patch };
    drafts[uri] = { ...next, look: parseLook(next) ?? next.look };
  }

  const hexHint = (value: string) =>
    normalizeBoardColor(value) ? 'Six-digit hex, like #1a73e8.' : 'Enter a six-digit hex color, like #1a73e8.';

  // Before hydration every trigger control shows, so a plain form still works;
  // with JS only the one the chosen kind needs stays visible.
  let hydrated = $state(false);
  onMount(() => (hydrated = true));

  const entryFor = (stamp: StampData) => ({
    id: stamp.uri,
    name: stamp.name,
    source: 'admin',
    look: stamp.look ?? undefined,
    uri: stamp.uri,
  });
</script>

{#if pending}
  <p class="atm-ok">Saved. The change is taking a few extra seconds to show up here — refresh to see it.</p>
{:else if saved}
  <p class="atm-ok">Saved.</p>
{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<datalist id="stamp-bg-presets">
  {#each PRESETS as preset (preset.label)}<option value={preset.bg}>{preset.label} background</option>{/each}
</datalist>
<datalist id="stamp-ink-presets">
  {#each PRESETS as preset (preset.label)}<option value={preset.ink}>{preset.label} ink</option>{/each}
</datalist>

{#snippet editor(id: string, uri: string, stamp: StampData | null)}
  {@const draft = draftFor(uri, stamp)}
  {@const low = isLowContrast(draft.look)}
  {@const warning = form?.uri === uri ? form.warning : undefined}
  <div class="atm-field">
    <label class="atm-label" for="{id}-name">Name</label>
    <input
      class="atm-input"
      id="{id}-name"
      name="name"
      required
      value={draft.name}
      oninput={(e) => edit(uri, stamp, { name: e.currentTarget.value })}
      placeholder="e.g. Regular"
      aria-describedby="{id}-name-help"
    />
    <span class="atm-hint" id="{id}-name-help">Up to {STAMP_NAME_MAX_GRAPHEMES} characters. Shows on the stamp, so keep it short.</span>
  </div>

  <fieldset class="trigger">
    <legend class="atm-label">Earned by</legend>
    <div class="atm-field">
      <label class="atm-label atm-label--quiet" for="{id}-kind">What earns it</label>
      <select
        class="atm-select"
        id="{id}-kind"
        name="kind"
        value={draft.kind}
        onchange={(e) => edit(uri, stamp, { kind: e.currentTarget.value })}
      >
        {#each TRIGGER_KINDS as kind (kind)}
          <option value={kind}>{TRIGGER_KIND_LABELS[kind]}</option>
        {/each}
      </select>
    </div>
    <div class="atm-field" hidden={hydrated && draft.kind !== 'firstPostInBoard'}>
      <label class="atm-label atm-label--quiet" for="{id}-board">Board (for a first post in a board)</label>
      <select
        class="atm-select"
        id="{id}-board"
        name="board"
        value={draft.board}
        onchange={(e) => edit(uri, stamp, { board: e.currentTarget.value })}
      >
        <option value="">(choose a board)</option>
        {#each data.boards as board (board.uri)}
          <option value={board.uri}>{board.name}</option>
        {/each}
      </select>
    </div>
    <div class="atm-field" hidden={hydrated && draft.kind !== 'profileBefore'}>
      <label class="atm-label atm-label--quiet" for="{id}-before">Date (for a profile created before)</label>
      <input
        class="atm-input"
        id="{id}-before"
        name="before"
        type="date"
        value={draft.before}
        oninput={(e) => edit(uri, stamp, { before: e.currentTarget.value })}
      />
    </div>
    <div class="atm-field" hidden={hydrated && draft.kind !== 'arrivedBy'}>
      <label class="atm-label atm-label--quiet" for="{id}-via">Route (for how they arrived)</label>
      <select
        class="atm-select"
        id="{id}-via"
        name="via"
        value={draft.via}
        onchange={(e) => edit(uri, stamp, { via: e.currentTarget.value })}
      >
        <option value="">(choose a route)</option>
        {#each ARRIVAL_ROUTES as route (route)}
          <option value={route}>{ROUTE_LABELS[route]}</option>
        {/each}
      </select>
    </div>
  </fieldset>

  <fieldset class="look">
    <legend class="atm-label">Look</legend>
    <div class="atm-editform__row">
      <div class="atm-field" class:atm-field--error={!normalizeBoardColor(draft.bg)}>
        <label class="atm-label atm-label--quiet" for="{id}-bg">Background</label>
        <span class="hex">
          <input
            class="hex__picker"
            type="color"
            value={draft.look.bg}
            aria-label="Choose background color"
            title="Choose background color"
            oninput={(e) => edit(uri, stamp, { bg: e.currentTarget.value })}
          />
          <input
            class="atm-input"
            id="{id}-bg"
            name="bg"
            list="stamp-bg-presets"
            required
            pattern={'#[0-9A-Fa-f]{6}'}
            maxlength="7"
            value={draft.bg}
            oninput={(e) => edit(uri, stamp, { bg: e.currentTarget.value })}
            aria-describedby="{id}-bg-help"
          />
        </span>
        <span class="atm-hint" id="{id}-bg-help">{hexHint(draft.bg)}</span>
      </div>
      <div class="atm-field" class:atm-field--error={!normalizeBoardColor(draft.ink)}>
        <label class="atm-label atm-label--quiet" for="{id}-ink">Ink</label>
        <span class="hex">
          <input
            class="hex__picker"
            type="color"
            value={draft.look.ink}
            aria-label="Choose ink color"
            title="Choose ink color"
            oninput={(e) => edit(uri, stamp, { ink: e.currentTarget.value })}
          />
          <input
            class="atm-input"
            id="{id}-ink"
            name="ink"
            list="stamp-ink-presets"
            required
            pattern={'#[0-9A-Fa-f]{6}'}
            maxlength="7"
            value={draft.ink}
            oninput={(e) => edit(uri, stamp, { ink: e.currentTarget.value })}
            aria-describedby="{id}-ink-help"
          />
        </span>
        <span class="atm-hint" id="{id}-ink-help">{hexHint(draft.ink)}</span>
      </div>
      <div class="atm-field">
        <label class="atm-label atm-label--quiet" for="{id}-shape">Shape</label>
        <select
          class="atm-select"
          id="{id}-shape"
          name="shape"
          value={draft.shape}
          onchange={(e) => edit(uri, stamp, { shape: e.currentTarget.value })}
        >
          {#each STAMP_SHAPES as shape (shape)}
            <option value={shape}>{shape}</option>
          {/each}
        </select>
      </div>
    </div>
    {#if low || warning}
      <p class="contrast">
        {warning ??
          `Ink on background is ${contrastRatio(draft.look.bg, draft.look.ink).toFixed(1)}:1, under the ${LOW_CONTRAST}:1 that stays legible at hovercard size.`}
      </p>
      <label class="confirm">
        <input type="checkbox" name="confirm" />
        save anyway
      </label>
    {/if}
  </fieldset>

  <StampPreview name={draft.name} look={draft.look} />
{/snippet}

<div class="atm-card panel">
  <div class="atm-card__header"><span>Default stamps</span></div>
  <div class="atm-card__body">
    <form class="defaults" method="POST" action="?/setHideDefaults">
      <label class="defaults__check">
        <input type="checkbox" name="hideDefaults" checked={data.hideDefaultStamps} />
        <span>
          <b>Hide the default stamps</b>
          <small>Every forum starts with a stamp for a member's first post in each board and one for how they arrived. Hide them to show only the stamps you define here; the network's own stamps stay.</small>
        </span>
      </label>
      <button class="atm-btn atm-btn--primary atm-btn--sm">save</button>
    </form>
  </div>
</div>

<div class="atm-card panel">
  <div class="atm-card__header"><span>Stamps</span></div>
  <div class="atm-card__body rows">
    {#each data.stamps as stamp, i (stamp.uri)}
      <details class="atm-adminrow">
        <summary>
          <span class="atm-adminrow__name">
            <Stamp entry={entryFor(stamp)} />
          </span>
          <span class="atm-adminrow__meta">
            {#if stamp.retired}<span class="retired">retired</span> · {/if}
            {stamp.triggerText}
          </span>
        </summary>
        {#if stamp.retired}
          <p class="atm-hint retired-note">
            This stamp's board was deleted, so nobody holds or sees it any more. Point it at another board to bring it back, or retire it to clear it from this list.
          </p>
        {/if}
        <form class="atm-editform" method="POST" action="?/updateStamp">
          <input type="hidden" name="uri" value={stamp.uri} />
          {@render editor(`s${i}`, stamp.uri, stamp)}
          <div class="atm-editform__actions">
            <button class="atm-btn atm-btn--primary atm-btn--sm">save</button>
          </div>
        </form>
        <form class="danger" method="POST" action="?/deleteStamp">
          <input type="hidden" name="uri" value={stamp.uri} />
          <label class="really">
            <input type="checkbox" name="really" />
            I understand that every member who holds or wears this stamp loses it.
          </label>
          <button class="atm-btn atm-btn--ghost atm-btn--sm">retire stamp</button>
        </form>
      </details>
    {:else}
      <p class="atm-empty atm-empty--bare">No stamps yet. Members still see the default and network stamps.</p>
    {/each}
  </div>
</div>

<div class="atm-card panel">
  <div class="atm-card__header"><span>New stamp</span></div>
  <div class="atm-card__body">
    <form class="atm-editform atm-editform--bare" method="POST" action="?/createStamp">
      {@render editor('new', 'new', null)}
      <div class="atm-editform__actions">
        <button class="atm-btn atm-btn--primary atm-btn--sm">create stamp</button>
      </div>
    </form>
  </div>
</div>

<style>
  .panel { max-width: 80ch; margin-bottom: var(--space-5); }
  .rows { display: grid; gap: var(--space-2); }
  .atm-editform--bare { padding: 0; border-top: 0; }
  .atm-label--quiet { text-transform: none; letter-spacing: 0; }

  .trigger, .look {
    display: grid;
    gap: var(--space-3);
    padding: 0;
    margin: 0;
    border: 0;
    min-width: 0;
  }
  .trigger legend, .look legend { margin-bottom: var(--space-1); padding: 0; }
  /* .atm-field's flex would beat the UA [hidden] rule. */
  .atm-field[hidden] { display: none; }

  .hex { display: flex; align-items: center; gap: var(--space-2); }
  .hex .atm-input { flex: 1; font-family: var(--font-mono); }
  .hex__picker {
    flex: none;
    width: 36px;
    height: 34px;
    padding: 3px;
    border-radius: var(--radius-sm);
    border: var(--border-hair) solid var(--forum-line-strong);
    background: var(--forum-surface);
    cursor: pointer;
  }

  .contrast {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--warn-bg);
    border: var(--border-hair) solid color-mix(in oklch, var(--warn-1) 40%, transparent);
    border-radius: var(--radius-md);
    color: var(--forum-ink);
    font: var(--type-meta);
  }
  .confirm, .really, .defaults__check {
    font: var(--type-meta);
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .really { color: var(--danger-1); }

  .retired {
    color: var(--warn-1);
    text-transform: uppercase;
    font-size: 0.85em;
    letter-spacing: 0.04em;
  }
  .retired-note { margin: 0; padding: var(--space-2) var(--space-3) 0; }
  .danger {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-3) var(--space-3);
  }

  .defaults { display: grid; gap: var(--space-3); justify-items: start; }
  .defaults__check { align-items: flex-start; font: var(--type-ui); }
  .defaults__check input { margin-top: 4px; }
  .defaults__check span { display: grid; gap: 2px; }
  .defaults__check b { font-weight: var(--w-semibold); }
  .defaults__check small { color: var(--forum-ink-soft); }

  @media (max-width: 640px) {
    .look .atm-editform__row { flex-direction: column; }
  }
</style>
