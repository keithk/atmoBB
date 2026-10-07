<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import Card from '$lib/components/Card.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import RichTextEditor from '$lib/components/RichTextEditor.svelte';
  import { profileHref } from '$lib/profile-card';
  import { profileLook } from '$lib/profile-page';
  import { THEME_PRESETS } from '$lib/themes';
  import type { PageData } from './$types';
  import type { Errors as FieldErrors } from './+page.server';

  type Values = PageData['values'];
  let { data, form }: {
    data: PageData;
    form: { saved?: boolean; moved?: boolean; message?: string; errors?: FieldErrors; values?: Values } | null;
  } = $props();

  // A move or a failed save hands back what was posted; otherwise show what's stored.
  const values = $derived(form?.values ?? data.values);
  const errors = $derived(form?.errors ?? {});
  const moveAction = $derived(`?/move&scope=${data.scope}`);

  // Live preview state, reset whenever the server hands back new values.
  let inherited = $derived([...values.inherit] as string[]);
  let skin = $derived(values.profileSkin);
  let pattern = $derived(values.bannerPattern);
  let swatch = $derived(values.bannerSwatch);
  let headline = $derived(values.headline);
  let currently = $derived(values.currently);
  let hiddenPanels = $derived(values.panels.filter((panel) => panel.hidden).map((panel) => panel.id));
  let panelOrder = $derived(values.panels.map((panel) => panel.id));
  let checkedPins = $derived([...values.pins]);

  let saving = $state(false);
  // The editor posts a hidden `about`; until it mounts (or without JavaScript) the
  // <noscript> box is the only `about` field, so the two never submit together.
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
    // Drag and keyboard reordering for the panel and pin lists; client-only, since it defines a custom element.
    import('$lib/elements/atm-reorder');
  });
  // <atm-reorder> moves rows itself, so read the panel order back from the form for the preview.
  const readPanelOrder = (event: Event) => {
    panelOrder = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLInputElement>('input[name="panel"]')].map((input) => input.value);
  };

  const hidesSkins = $derived(data.forum.hideProfileSkins === true);
  const look = $derived(profileLook({
    profileSkin: skin,
    banner: pattern ? { pattern, swatch } : undefined,
    forumHidesSkins: hidesSkins,
    ownerBanned: false,
  }));
  const swatchStyle = (value: string) => profileLook({ banner: { pattern: 'plain', swatch: value }, forumHidesSkins: false, ownerBanned: false }).banner?.style;

  const PANEL_LABELS: Record<string, { label: string; note?: string }> = $derived({
    about: { label: 'About me', note: 'rich text' },
    pinned: { label: 'Pinned topics', note: `up to ${data.maxPins}` },
    stamps: { label: 'Stamps' },
    regulars: { label: 'Regulars', note: 'who you reply alongside most' },
    activity: { label: 'Recent activity' },
    guestbook: { label: 'Guestbook', note: 'notes from other members' },
    bluesky: { label: 'Recent on Bluesky' },
    signature: { label: 'Signature' },
  });
  const PATTERN_LABELS: Record<string, string> = { plain: 'Plain', stars: 'Stars', scanlines: 'Scanlines', checker: 'Checker' };

  const topicsByUri = $derived(new Map((data.topics ?? []).map((topic) => [topic.uri, topic])));
  const pinnedRows = $derived(values.pins.map((uri) => topicsByUri.get(uri) ?? { uri, title: 'A topic no longer listed', board: '', createdAt: '' }));
  const unpinnedRows = $derived((data.topics ?? []).filter((topic) => !values.pins.includes(topic.uri)));

  const editing = (field: string) => () => {
    inherited = inherited.filter((value) => value !== field);
  };
  const toggle = (list: string[], value: string, on: boolean) => (on ? [...list, value] : list.filter((item) => item !== value));
</script>

<svelte:head><title>Profile page · atmoBB</title></svelte:head>

{#snippet inheritance(field: string, label: string)}
  {#if data.scope === 'forum'}
    <label class="inherit-choice">
      <input type="checkbox" name="inherit" value={field} checked={inherited.includes(field)}
        onchange={(event) => (inherited = toggle(inherited, field, event.currentTarget.checked))}
        aria-label={`Use my account default for ${label}`} />
      Use my account default
    </label>
  {/if}
{/snippet}

{#snippet fieldError(field: keyof FieldErrors)}
  {#if errors[field]}<span class="atm-err" id={`${field}-error`} role="alert">{errors[field]}</span>{/if}
{/snippet}

<div class="customize">
  <Card title="Customize your profile page">
    <form
      method="POST"
      action={`?/save&scope=${data.scope}`}
      class="edit"
      use:enhance={() => {
        saving = true;
        return async ({ action, update }) => {
          try {
            // A move only reorders the form; nothing stored changed, so skip reloading the topic list.
            await update({ reset: false, invalidateAll: !action.search.includes('/move') });
          } finally {
            saving = false;
          }
        };
      }}
    >
      <!-- Pressing Enter in a field submits with the first submit button; make that Save, not a move. -->
      <button class="default-save" tabindex="-1" aria-hidden="true" disabled={saving}>Save changes</button>
      <p class="lede">
        Your profile page is what members see when they open your name. Pick its colors and banner,
        write a little about yourself, and choose what shows.
        <a href={profileHref(data.did)}>See your page</a>.
      </p>

      <nav class="scope" aria-label="Where these settings apply">
        <a class="atm-btn atm-btn--sm {data.scope === 'forum' ? 'atm-btn--primary' : 'atm-btn--secondary'}"
          href="?scope=forum" aria-current={data.scope === 'forum' ? 'page' : undefined}>This forum only — {data.forum.name}</a>
        <a class="atm-btn atm-btn--sm {data.scope === 'all' ? 'atm-btn--primary' : 'atm-btn--secondary'}"
          href="?scope=all" aria-current={data.scope === 'all' ? 'page' : undefined}>All atmobb forums — account defaults</a>
      </nav>
      <p class="atm-hint">
        Save before switching.
        {data.scope === 'forum'
          ? 'Checked sections follow your account default; uncheck one to set it just for this forum.'
          : 'Used wherever you haven’t chosen something forum-specific. Existing forum choices stay unchanged.'}
      </p>

      <fieldset id="skin" class="section" class:atm-field--error={!!errors.profileSkin}>
        <legend class="atm-label">Skin</legend>
        {@render inheritance('profileSkin', 'skin')}
        {#if hidesSkins}
          <p class="atm-notice">This forum shows profile pages in its own colors; your skin applies on forums that allow it.</p>
        {/if}
        <div class="skins" onchange={editing('profileSkin')}>
          <label class="skin" class:skin--on={skin === ''}>
            <span class="skin__swatches skin__swatches--forum" aria-hidden="true"></span>
            <span class="skin__name">
              <input type="radio" name="profileSkin" value="" checked={skin === ''} onchange={() => (skin = '')} />
              Forum’s look
            </span>
          </label>
          {#each THEME_PRESETS as preset (preset.value)}
            <label class="skin" class:skin--on={skin === preset.value} title={preset.description}>
              <span class="skin__swatches" aria-hidden="true">
                {#each preset.swatches as color, i (i)}<span style:background={color}></span>{/each}
              </span>
              <span class="skin__name">
                <input type="radio" name="profileSkin" value={preset.value} checked={skin === preset.value} onchange={() => (skin = preset.value)} />
                {preset.label}
              </span>
            </label>
          {/each}
        </div>
        {@render fieldError('profileSkin')}
        <p class="atm-hint">Visitors see your page in this skin. The forum’s header and navigation keep the forum’s look.</p>
      </fieldset>

      <fieldset id="banner" class="section" class:atm-field--error={!!errors.banner}>
        <legend class="atm-label">Banner</legend>
        {@render inheritance('banner', 'banner')}
        <fieldset class="choices" onchange={editing('banner')}>
          <legend class="atm-hint">Pattern</legend>
          <label class="choice" class:choice--on={pattern === ''}>
            <input type="radio" name="bannerPattern" value="" checked={pattern === ''} onchange={() => (pattern = '')} />
            No banner
          </label>
          {#each data.bannerPatterns as value (value)}
            <label class="choice" class:choice--on={pattern === value}>
              <input type="radio" name="bannerPattern" value={value} checked={pattern === value} onchange={() => (pattern = value)} />
              {PATTERN_LABELS[value] ?? value}
            </label>
          {/each}
        </fieldset>
        <fieldset class="swatches" onchange={editing('banner')}>
          <legend class="atm-hint">Color</legend>
          {#each data.bannerSwatches as value (value)}
            <label class="swatch" class:swatch--on={swatch === value}>
              <input type="radio" name="bannerSwatch" value={value} checked={swatch === value} onchange={() => (swatch = value)} />
              <span class="swatch__chip" style={swatchStyle(value)} aria-hidden="true"></span>
              {value}
            </label>
          {/each}
        </fieldset>
        {@render fieldError('banner')}
        {#if hidesSkins}<p class="atm-hint">Here the banner keeps your pattern but uses the forum’s accent color.</p>{/if}
      </fieldset>

      <div id="headline" class="atm-field section" class:atm-field--error={!!errors.headline}>
        <label class="atm-label" for="headline-input">Headline</label>
        {@render inheritance('headline', 'headline')}
        <input id="headline-input" class="atm-input" name="headline" value={headline}
          oninput={(event) => { headline = event.currentTarget.value; editing('headline')(); }}
          aria-invalid={errors.headline ? 'true' : undefined} aria-describedby={errors.headline ? 'headline-error' : 'headline-hint'} />
        {@render fieldError('headline')}
        <span class="atm-hint" id="headline-hint">Shown under your name, in italics. 80 characters.</span>
      </div>

      <div class="atm-field section" class:atm-field--error={!!errors.currently}>
        <label class="atm-label" for="currently-input">Currently</label>
        {@render inheritance('currently', 'currently line')}
        <input id="currently-input" class="atm-input" name="currently" value={currently} placeholder="reading, building, listening to…"
          oninput={(event) => { currently = event.currentTarget.value; editing('currently')(); }}
          aria-invalid={errors.currently ? 'true' : undefined} aria-describedby={errors.currently ? 'currently-error' : 'currently-hint'} />
        {@render fieldError('currently')}
        <span class="atm-hint" id="currently-hint">What you’re up to right now. 80 characters.</span>
      </div>

      <div id="about" class="atm-field section" class:atm-field--error={!!errors.about}>
        <span class="atm-label" id="about-label">About me</span>
        {@render inheritance('about', 'About me')}
        <div oninput={editing('about')}>
          {#if mounted}
            <RichTextEditor name="about" initial={values.aboutDoc} placeholder="Say hello, list your projects, tell people what you’re into…" />
          {/if}
          <noscript>
            <textarea class="atm-textarea" name="about" rows="8" aria-labelledby="about-label">{values.about}</textarea>
            <input type="hidden" name="about__images" value={values.aboutImages} />
            <span class="atm-hint">Formatting uses BBCode, like [b]bold[/b] and [i]italic[/i].</span>
          </noscript>
        </div>
        {@render fieldError('about')}
        <span class="atm-hint">Longer than your bio, shown in its own panel.</span>
      </div>

      <fieldset id="panels" class="section" class:atm-field--error={!!errors.panels}>
        <legend class="atm-label">Panels</legend>
        {@render inheritance('panels', 'panels')}
        <atm-reorder onreorder={(event: Event) => { readPanelOrder(event); editing('panels')(); }}>
        <!-- Rebuild the rows when the server hands back an order, since <atm-reorder> may have moved them behind Svelte's back. -->
        {#key values}
        <ol class="rows" onchange={editing('panels')}>
          {#each values.panels as panel, i (panel.id)}
            {@const info = PANEL_LABELS[panel.id] ?? { label: panel.id }}
            <li class="row" data-reorder-item data-reorder-label={info.label}>
              <span class="row__handle" data-reorder-handle aria-hidden="true">⠿</span>
              <input type="hidden" name="panel" value={panel.id} />
              <label class="row__label">
                <input type="checkbox" name="show" value={panel.id} checked={!hiddenPanels.includes(panel.id)}
                  onchange={(event) => (hiddenPanels = toggle(hiddenPanels, panel.id, !event.currentTarget.checked))} />
                {info.label}
              </label>
              {#if info.note}<span class="atm-hint">{info.note}</span>{/if}
              <span class="row__moves">
                <button class="atm-btn atm-btn--ghost atm-btn--sm" type="submit" formaction={moveAction} name="move" data-reorder-up
                  value={`panel:up:${panel.id}`} disabled={saving || i === 0} aria-label={`Move ${info.label} up`}>↑</button>
                <button class="atm-btn atm-btn--ghost atm-btn--sm" type="submit" formaction={moveAction} name="move" data-reorder-down
                  value={`panel:down:${panel.id}`} disabled={saving || i === values.panels.length - 1} aria-label={`Move ${info.label} down`}>↓</button>
              </span>
            </li>
          {/each}
        </ol>
        {/key}
        <p class="atm-hint reorder-hint">Drag a row by its handle, or press Alt+↑ / Alt+↓ on it, to move it.</p>
        </atm-reorder>
        {@render fieldError('panels')}
        <p class="atm-hint">Unchecked panels are hidden from visitors; you still see them on your page. Moving a panel doesn’t save it; press Save when you’re done.</p>
      </fieldset>

      <fieldset id="pins" class="section" class:atm-field--error={!!errors.pins}>
        <legend class="atm-label">Pinned topics</legend>
        {#if !data.pinsReadable}
          <p class="atm-err">We couldn’t load your topics right now, so your pins are left as they are. Try again in a minute.</p>
        {:else}
          <input type="hidden" name="pinsShown" value="1" />
          <p class="atm-hint" aria-live="polite">
            <strong class:atm-err={checkedPins.length > data.maxPins}>{checkedPins.length} of {data.maxPins} pinned.</strong>
            Pins belong to this forum, whichever scope you’re editing.
          </p>
          {#if !pinnedRows.length && !unpinnedRows.length}
            <p class="atm-empty atm-empty--bare">You haven’t started any topics here yet.</p>
          {:else}
            <atm-reorder>
            {#key values}
            <ol class="rows">
              {#each pinnedRows as topic, i (topic.uri)}
                <li class="row" data-reorder-item data-reorder-label={topic.title}>
                  <span class="row__handle" data-reorder-handle aria-hidden="true">⠿</span>
                  <label class="row__label">
                    <input type="checkbox" name="pin" value={topic.uri} checked={checkedPins.includes(topic.uri)}
                      onchange={(event) => (checkedPins = toggle(checkedPins, topic.uri, event.currentTarget.checked))} />
                    <span class="topic">{topic.title}{#if topic.board} <span class="atm-hint">in {topic.board}</span>{/if}</span>
                  </label>
                  <span class="row__moves">
                    <button class="atm-btn atm-btn--ghost atm-btn--sm" type="submit" formaction={moveAction} name="move" data-reorder-up
                      value={`pin:up:${topic.uri}`} disabled={saving || i === 0} aria-label={`Move ${topic.title} up`}>↑</button>
                    <button class="atm-btn atm-btn--ghost atm-btn--sm" type="submit" formaction={moveAction} name="move" data-reorder-down
                      value={`pin:down:${topic.uri}`} disabled={saving || i === pinnedRows.length - 1} aria-label={`Move ${topic.title} down`}>↓</button>
                  </span>
                </li>
              {/each}
            </ol>
            {/key}
            </atm-reorder>
            {#if unpinnedRows.length}
              <ul class="rows rows--plain">
                {#each unpinnedRows as topic (topic.uri)}
                  <li class="row">
                    <label class="row__label">
                      <input type="checkbox" name="pin" value={topic.uri} checked={checkedPins.includes(topic.uri)}
                        onchange={(event) => (checkedPins = toggle(checkedPins, topic.uri, event.currentTarget.checked))} />
                      <span class="topic">{topic.title} <span class="atm-hint">in {topic.board}</span></span>
                    </label>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if data.topicsCapped}<p class="atm-hint">Showing your {data.topicLimit} newest topics.</p>{/if}
          {/if}
        {/if}
        {@render fieldError('pins')}
      </fieldset>

      <fieldset id="guestbook" class="section" class:atm-field--error={!!errors.guestbook}>
        <legend class="atm-label">Guestbook</legend>
        {#if !data.guestbook}
          <p class="atm-err">We couldn’t load your guestbook settings right now, so they’re left as they are. Try again in a minute.</p>
        {:else}
          <input type="hidden" name="guestbookShown" value="1" />
          <label class="row__label">
            <input type="checkbox" name="guestbook" checked={values.guestbookOpen} aria-describedby="guestbook-hint" />
            Open my guestbook
          </label>
          <p class="atm-hint" id="guestbook-hint">
            Off by default. Members can leave you short notes. You can hide any note or block someone; your hidden
            and blocked lists are public on your account. Your guestbook belongs to this forum, whichever scope you’re editing.
          </p>
          {#if data.guestbook.blocked.length}
            <h3 class="atm-label sublabel">Blocked members</h3>
            <ul class="rows">
              {#each data.guestbook.blocked as member (member.did)}
                <li class="row">
                  <span class="row__label topic">{member.handle ? `@${member.handle}` : member.did}</span>
                  <button class="atm-btn atm-btn--ghost atm-btn--sm" form="guestbook-unblock" name="did" value={member.did}>Unblock</button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if data.guestbook.hidden.length}
            <h3 class="atm-label sublabel">Hidden notes</h3>
            <ul class="rows">
              {#each data.guestbook.hidden as note (note.uri)}
                <li class="row">
                  <span class="row__label topic">
                    {#if note.text}<span class="note-text">“{note.text}”</span>{:else}A note{/if}
                    <span class="atm-hint">from {note.handle ? `@${note.handle}` : note.author || 'someone'}</span>
                  </span>
                  <button class="atm-btn atm-btn--ghost atm-btn--sm" form="guestbook-unhide" name="uri" value={note.uri}>Unhide</button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if data.guestbook.blocked.length || data.guestbook.hidden.length}
            <p class="atm-hint">Unblock and Unhide save right away, without the rest of the page.</p>
          {/if}
        {/if}
        {@render fieldError('guestbook')}
      </fieldset>

      <div class="actions">
        <span class="status" aria-live="polite">
          {#if form?.message}<span class="atm-err">{form.message}</span>
          {:else if form?.saved}<span class="atm-ok">{data.scope === 'forum' ? 'Profile page saved for this forum' : 'Account defaults saved'} ✓</span>
          {:else if form?.moved}<span class="atm-hint">Moved. Save to keep the new order.</span>
          {:else}<span class="atm-hint">{data.scope === 'forum' ? `Changes apply only to ${data.forum.name}.` : 'Changes apply to your account defaults.'}</span>{/if}
        </span>
        <a class="atm-btn atm-btn--ghost" href={profileHref(data.did)}>Cancel</a>
        <button class="atm-btn atm-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
    <!-- Unblock and Unhide buttons sit in the guestbook section above and submit these, since forms can't nest. -->
    <form id="guestbook-unblock" method="POST" action={`?/unblock&scope=${data.scope}`} hidden></form>
    <form id="guestbook-unhide" method="POST" action={`?/unhide&scope=${data.scope}`} hidden></form>
  </Card>

  <section class="preview" aria-label="Preview">
    <span class="atm-eyebrow">Preview · as visitors see it</span>
    <div class="preview__page" style={look.style}>
      <div class="preview__head">
        {#if look.banner}<div class="preview__banner" style={look.banner.style}></div>{/if}
        <div class="preview__who" class:preview__who--lifted={!!look.banner}>
          <Avatar seed={data.did} profile={data.avatarProfile} size={64} alt="" />
          <div class="preview__names">
            <span class="preview__name">{data.avatarProfile?.displayName || data.handle}</span>
            {#if headline}<span class="preview__headline">{headline}</span>{/if}
            {#if currently}<span class="preview__currently"><span>currently ▸</span> {currently}</span>{/if}
          </div>
        </div>
      </div>
      {#each panelOrder.filter((id) => !hiddenPanels.includes(id)).slice(0, 4) as id (id)}
        <div class="preview__panel">
          <div class="preview__panel-title">{PANEL_LABELS[id]?.label ?? id}</div>
          <div class="preview__panel-body" aria-hidden="true"><span></span><span></span></div>
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  @layer atmobb {
  .customize { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-start; }
  .customize > :global(.atm-card) { flex: 1 1 420px; min-width: 0; }

  .edit { display: flex; flex-direction: column; gap: var(--space-6); }
  .default-save { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; padding: 0; }
  .lede { margin: 0; font: var(--type-meta); color: var(--forum-ink-soft); }
  .scope { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .scope + .atm-hint { margin-top: calc(-1 * var(--space-2)); }
  .inherit-choice { display: flex; align-items: center; gap: var(--space-2); font: var(--type-meta); color: var(--forum-ink-soft); }

  .section { display: flex; flex-direction: column; gap: var(--space-2); border: 0; margin: 0; padding: 0; min-width: 0; scroll-margin-top: var(--space-4); }
  .section legend { padding: 0; margin-bottom: var(--space-2); }
  .section p { margin: 0; }
  input[type='radio'], input[type='checkbox'] { accent-color: var(--forum-accent); margin: 0; }

  .skins { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-2); }
  .skin {
    display: flex; flex-direction: column; gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-solid) solid var(--forum-line);
    border-radius: var(--radius-md);
    background: var(--forum-surface);
    cursor: pointer;
  }
  .skin--on, .skin:has(input:checked) { border-color: var(--forum-accent); }
  .skin:has(input:focus-visible) { box-shadow: var(--focus-ring); }
  .skin__swatches { display: flex; height: 28px; border-radius: var(--radius-sm); overflow: hidden; border: var(--border-hair) solid var(--forum-line); }
  .skin__swatches span:first-child { flex: 2; }
  .skin__swatches span { flex: 1; }
  .skin__swatches--forum { background: linear-gradient(90deg, var(--forum-bg) 50%, var(--forum-accent) 50% 75%, var(--forum-ink) 75%); }
  .skin__name { display: flex; align-items: center; gap: var(--space-2); font: var(--type-ui); }

  .choices, .swatches { display: flex; flex-wrap: wrap; gap: var(--space-2); border: 0; margin: 0; padding: 0; min-width: 0; }
  .choices legend, .swatches legend { padding: 0; margin-bottom: var(--space-1); width: 100%; }
  .choice, .swatch {
    display: inline-flex; align-items: center; gap: var(--space-2);
    min-height: 36px; padding: 0 var(--space-3);
    border: var(--border-solid) solid var(--forum-line);
    border-radius: var(--radius-md);
    font: var(--type-ui);
    cursor: pointer;
  }
  .choice--on, .choice:has(input:checked), .swatch--on, .swatch:has(input:checked) { border-color: var(--forum-accent); }
  .swatch { text-transform: capitalize; }
  .swatch__chip { width: 16px; height: 16px; border-radius: var(--radius-xs); }

  .rows { list-style: none; margin: 0; padding: 0; border: var(--border-hair) solid var(--forum-line); border-radius: var(--radius-md); }
  .rows--plain { margin-top: var(--space-2); }
  .row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); min-height: 40px; }
  .row + .row { border-top: var(--border-hair) solid var(--forum-line); }
  .row__label { flex: 1; display: flex; align-items: center; gap: var(--space-2); font: var(--type-ui); cursor: pointer; min-width: 0; }
  .row__moves { display: inline-flex; gap: 2px; }
  .row__handle { cursor: grab; touch-action: none; user-select: none; color: var(--forum-ink-soft); }
  .row:global([data-reorder-dragging]) { background: var(--forum-surface-2); }
  .row:global([data-reorder-dragging]) .row__handle { cursor: grabbing; }
  /* Drag and Alt+arrow only work once <atm-reorder> is defined; until then the move buttons post to the server. */
  atm-reorder:not(:defined) :is(.row__handle, .reorder-hint) { display: none; }
  .topic { min-width: 0; overflow-wrap: anywhere; }
  .sublabel { margin: var(--space-2) 0 0; }
  .note-text { white-space: pre-wrap; }

  .actions {
    display: flex; align-items: center; gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: var(--border-hair) solid var(--forum-line);
  }
  .status { margin-right: auto; }

  .preview { flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: var(--space-2); position: sticky; top: var(--space-4); }
  .preview__page {
    display: flex; flex-direction: column; gap: var(--space-3);
    padding: var(--space-3);
    background: var(--forum-bg);
    color: var(--forum-ink);
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-md);
  }
  .preview__head, .preview__panel {
    background: var(--forum-surface);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .preview__banner { height: 72px; border-bottom: 3px solid var(--forum-accent); }
  .preview__who { display: flex; align-items: flex-end; gap: var(--space-3); padding: var(--space-3); }
  .preview__who--lifted { margin-top: -36px; }
  .preview__names { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .preview__name { font: var(--type-thread-title); }
  .preview__headline { font: var(--type-sig); font-style: italic; overflow-wrap: anywhere; }
  .preview__currently { font: var(--type-handle); color: var(--forum-ink-soft); overflow-wrap: anywhere; }
  .preview__currently span { color: var(--forum-link); }
  .preview__panel-title {
    padding: var(--space-2) var(--space-3);
    font: var(--type-board-title);
    background: var(--forum-surface-2);
    border-bottom: 2px solid var(--forum-accent);
  }
  .preview__panel-body { display: flex; flex-direction: column; gap: 6px; padding: var(--space-3); }
  .preview__panel-body span { display: block; height: 8px; width: 80%; border-radius: 2px; background: var(--forum-line); }
  .preview__panel-body span + span { width: 55%; }

  @media (max-width: 560px) {
    .actions { flex-wrap: wrap; justify-content: flex-end; }
    .status { width: 100%; }
    .preview { position: static; }
  }
  }
</style>
