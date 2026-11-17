<script lang="ts">
  // The nine built-in themes as cards, each a tiny forum drawn in that theme's
  // look, choosing which screenshot of atmobb.app shows below. Plain radios and
  // :has(), so it works before any script loads. The six light themes have a
  // dark screenshot too, shown when the visitor's device is in dark mode.
  const themes = [
    { id: 'atmosphere', name: 'Atmosphere', dark: true, caption: 'A tinted sidebar with pill navigation beside one flat sheet. New forums start here.' },
    { id: 'coral', name: 'Coral', dark: true, caption: 'One card on a warm grey ground, with coral buttons. The original atmoBB look.' },
    { id: 'bulletin', name: 'Bulletin', dark: true, caption: 'A 2004 message board: small Verdana, boxed tables, gradient header bars.' },
    { id: 'bubblegum', name: 'Bubblegum', dark: true, caption: 'Sticker-sheet cards with thick outlines in pink and aqua.' },
    { id: 'graphite', name: 'Graphite', dark: true, caption: 'Dense and quiet, like an issue tracker.' },
    { id: 'daydream', name: 'Daydream', dark: true, caption: 'A soft gradient sky behind frosted, rounded panels.' },
    { id: 'midnight', name: 'Midnight', dark: false, caption: 'Navy panels on a star field, with amber for unread. Dark only.' },
    { id: 'terminal', name: 'Terminal', dark: false, caption: 'Monospace on near-black, with phosphor green and dashed rules. Dark only.' },
    { id: 'arcade', name: 'Arcade', dark: false, caption: 'Pixel headings and square corners in cyan and magenta on indigo. Dark only.' },
  ];
</script>

<div class="tour">
  <fieldset class="tpicker">
    <legend>Show the forum in</legend>
    {#each themes as theme}
      <label class="tcard">
        <input type="radio" name="tour-theme" value={theme.id} checked={theme.id === 'atmosphere'} />
        <span class="mf mf--{theme.id}" aria-hidden="true">
          <span class="mf__side"><b></b><b></b><b></b><b></b></span>
          <span class="mf__sheet"><b class="mf__bar"></b><b class="mf__row"></b><b class="mf__row"></b><b class="mf__row"></b><b class="mf__btn"></b></span>
        </span>
        <span class="tcard__name">{theme.name}</span>
        <span class="tcard__check" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        </span>
      </label>
    {/each}
  </fieldset>

  <figure class="frame">
    <div class="frame__bar">
      <span class="frame__dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="frame__url">atmobb.app/?previewTheme={#each themes as theme}<span data-t={theme.id}>{theme.id}</span>{/each}</span>
    </div>
    <div class="stage">
      {#each themes as theme}
        <!-- Hidden screenshots don't load until their theme is picked. -->
        <div class="shot" data-t={theme.id}>
          <picture>
            {#if theme.dark}
              <source srcset="/marketing/home-{theme.id}-dark.webp" media="(prefers-color-scheme: dark)" />
            {/if}
            <img
              src="/marketing/home-{theme.id}.webp"
              alt="The atmoBB forum home page in the {theme.name} theme"
              width="1440"
              height="1000"
              loading="lazy"
              decoding="async"
            />
          </picture>
        </div>
      {/each}
    </div>
  </figure>
  <div class="caption" aria-live="polite">
    {#each themes as theme}
      <p data-t={theme.id}><b>{theme.name}.</b> {theme.caption}</p>
    {/each}
  </div>
  <p class="note">Every screenshot here is the atmoBB forum.</p>
</div>

<style>
  @layer atmobb {
  .tour { display: flex; flex-direction: column; gap: 16px; min-width: 0; container-type: inline-size; }
  legend { padding: 0; margin-bottom: 10px; font: var(--w-semibold) var(--text-sm)/1.3 var(--font-body); color: var(--forum-ink-soft); }
  .tpicker {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  @container (min-width: 520px) { .tpicker { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
  @container (min-width: 860px) { .tpicker { grid-template-columns: repeat(9, minmax(0, 1fr)); } }

  .tcard {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 5px 5px 8px;
    background: var(--forum-surface);
    border: 1px solid var(--forum-line-strong);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: translate 180ms cubic-bezier(0.25, 1, 0.5, 1), box-shadow 180ms ease, border-color 180ms ease;
  }
  .tcard:hover { translate: 0 -2px; box-shadow: var(--shadow-md); }
  .tcard:active { translate: 0 0; }
  .tcard input { position: absolute; inset: 0; z-index: 2; margin: 0; opacity: 0; cursor: pointer; }
  .tcard:has(input:focus-visible) { outline: 2px solid var(--forum-accent); outline-offset: 2px; }
  .tcard:has(input:checked) { border-color: var(--forum-accent); box-shadow: 0 0 0 1px var(--forum-accent), var(--shadow-md); }
  .tcard__name { text-align: center; font: var(--w-medium) 13.5px/1.2 var(--font-body); color: var(--forum-ink-soft); }
  .tcard:has(input:checked) .tcard__name { color: var(--forum-link); font-weight: var(--w-semibold); }
  /* the chosen card wears the log-in card's badge */
  .tcard__check {
    position: absolute;
    top: -7px;
    right: -7px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    color: var(--forum-accent-ink);
    background: var(--forum-accent);
    border: 2px solid var(--forum-surface);
    border-radius: 50%;
    scale: 0;
  }
  .tcard__check svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .tcard:has(input:checked) .tcard__check { scale: 1; transition: scale 260ms cubic-bezier(0.34, 1.56, 0.64, 1); }

  /* the mini forum: sidebar of nav lines, a sheet with a header bar, rows and a button */
  .mf {
    --m-r: 4px;
    display: grid;
    grid-template-columns: 26% minmax(0, 1fr);
    gap: 4px;
    aspect-ratio: 4 / 3;
    padding: 5px;
    background: var(--m-bg);
    border-radius: 9px;
    overflow: hidden;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
  }
  .mf b { display: block; border-radius: 2px; }
  .mf__side { display: flex; flex-direction: column; gap: 4px; padding: 5px 2px; }
  .mf__side b { height: 3px; background: var(--m-faint); }
  .mf__side b:first-child { height: 6px; border-radius: 3px; background: var(--m-accent); }
  .mf__sheet { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 5px; background: var(--m-sheet); border-radius: var(--m-r); }
  .mf__bar { height: 6px; background: var(--m-bar); }
  .mf__row { height: 4px; background: var(--m-line); }
  .mf__row:nth-child(2) { width: 88%; }
  .mf__row:nth-child(3) { width: 64%; }
  .mf__row:nth-child(4) { width: 76%; }
  .mf__btn { width: 34%; height: 6px; margin-top: auto; background: var(--m-accent); border-radius: 3px; }
  .tcard:has(input:checked) .mf__btn { animation: pop 360ms cubic-bezier(0.34, 1.56, 0.64, 1); }
  @keyframes pop { 40% { scale: 1.35; } }

  .mf--atmosphere { --m-bg: #f1f3f6; --m-sheet: #fff; --m-bar: #e3e7ec; --m-line: #dfe4ea; --m-faint: #c9d1db; --m-accent: #0a66d8; }
  .mf--atmosphere .mf__sheet { margin: 2px -5px -5px 0; border-radius: 6px 0 0 0; }
  .mf--coral { --m-bg: #eceae7; --m-sheet: #fff; --m-bar: #2b2a2e; --m-line: #e6e2dd; --m-accent: #f79b7a; grid-template-columns: minmax(0, 1fr); padding: 8px 10px; }
  .mf--coral .mf__side { display: none; }
  .mf--coral .mf__sheet { border-radius: 7px; box-shadow: 0 2px 5px rgb(60 40 20 / 0.15); }
  .mf--coral .mf__bar { width: 46%; height: 5px; }
  .mf--bulletin { --m-bg: #dfe6ef; --m-sheet: #fff; --m-line: #eef2f7; --m-faint: #9fb3cf; --m-accent: #2f5f9e; --m-r: 0; }
  .mf--bulletin .mf__sheet { gap: 0; padding: 0 0 4px; border: 1px solid #8aa3c4; }
  .mf--bulletin .mf__bar { height: 8px; border-radius: 0; background: linear-gradient(#5b88c4, #2f5f9e); }
  .mf--bulletin .mf__row { width: auto; height: 7px; border-radius: 0; border-bottom: 1px solid #c7d3e3; }
  .mf--bulletin .mf__btn { margin-left: 4px; border-radius: 1px; }
  .mf--bubblegum { --m-bg: #ffe3f0; --m-sheet: #fff; --m-bar: #ff5fa8; --m-line: #ffd0e6; --m-faint: #ff9ccb; --m-accent: #7ee8dc; --m-r: 7px; }
  .mf--bubblegum .mf__sheet { margin: 0 2px 2px 0; border: 1.5px solid #2b1b2e; box-shadow: 2px 2px 0 #2b1b2e; }
  .mf--bubblegum .mf__bar { border-radius: 4px; }
  .mf--bubblegum .mf__btn { outline: 1.5px solid #2b1b2e; }
  .mf--graphite { --m-bg: #f6f7f9; --m-sheet: #fff; --m-bar: #1f2328; --m-line: #d8dde3; --m-faint: #b8c0ca; --m-accent: #4f46e5; --m-r: 3px; }
  .mf--graphite .mf__sheet { gap: 3px; border: 1px solid #d0d7de; }
  .mf--graphite .mf__bar { width: 50%; height: 4px; }
  .mf--graphite .mf__row { height: 2px; margin-bottom: 3px; box-shadow: 0 4px 0 #e6e9ed; }
  .mf--daydream { --m-bg: linear-gradient(160deg, #e3d4fb, #fbdcec 55%, #d8e6fb); --m-sheet: rgb(255 255 255 / 0.62); --m-bar: #7a59e6; --m-line: rgb(122 89 230 / 0.2); --m-faint: rgb(122 89 230 / 0.35); --m-accent: #ec6fb0; --m-r: 8px; }
  .mf--daydream .mf__sheet { box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.9); }
  .mf--daydream .mf__bar { border-radius: 4px; }
  .mf--midnight {
    --m-sheet: #1c2033;
    --m-bar: #2a2f4a;
    --m-line: #2e3350;
    --m-faint: #3a4064;
    --m-accent: #ffb454;
    --m-bg:
      radial-gradient(circle at 12% 18%, #fff8 0 0.8px, transparent 1.2px),
      radial-gradient(circle at 70% 8%, #fff6 0 0.7px, transparent 1.1px),
      radial-gradient(circle at 40% 92%, #fff7 0 0.8px, transparent 1.2px),
      radial-gradient(circle at 92% 60%, #fff5 0 0.7px, transparent 1.1px),
      #12131a;
  }
  .mf--midnight .mf__btn { width: 6px; border-radius: 50%; }
  .mf--terminal { --m-bg: #0a0d0a; --m-sheet: transparent; --m-line: rgb(61 220 132 / 0.55); --m-faint: rgb(61 220 132 / 0.35); --m-accent: #3ddc84; --m-r: 0; }
  .mf--terminal .mf__sheet { border: 1px dashed rgb(61 220 132 / 0.45); }
  .mf--terminal .mf__bar { height: auto; background: none; font: 600 7px/1 var(--font-mono); color: #3ddc84; }
  .mf--terminal .mf__bar::before { content: '> _'; }
  .mf--terminal .mf__row { height: 2px; }
  .mf--terminal .mf__btn { height: 5px; border-radius: 0; }
  .mf--terminal .mf__side b:first-child { border-radius: 0; }
  .mf--arcade { --m-bg: #110d24; --m-sheet: #1b1438; --m-bar: #ff4fd8; --m-line: rgb(34 211 238 / 0.45); --m-faint: rgb(255 79 216 / 0.5); --m-accent: #22d3ee; --m-r: 0; }
  .mf--arcade .mf__sheet { border: 2px solid #ff4fd8; }
  .mf--arcade b,
  .mf--arcade .mf__side b:first-child { border-radius: 0; }

  /* the screenshot, framed as a browser window */
  .frame { margin: 0; overflow: hidden; background: var(--forum-sunken); border: 1px solid var(--forum-line-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); }
  .frame__bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--forum-surface-2); border-bottom: 1px solid var(--forum-line); }
  .frame__dots { display: flex; gap: 6px; }
  .frame__dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--forum-line-strong); }
  .frame__url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 3px 12px;
    background: var(--forum-surface);
    border: 1px solid var(--forum-line);
    border-radius: var(--radius-round);
    font: 400 12.5px var(--font-mono);
    color: var(--forum-ink-soft);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .stage { aspect-ratio: 1440 / 1000; }
  .shot { height: 100%; animation: fade 240ms cubic-bezier(0.16, 1, 0.3, 1); }
  .shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: 0 0; }
  @keyframes fade { from { opacity: 0; } }
  .caption p { margin: 0; font: var(--type-ui); color: var(--forum-ink-soft); }
  .caption b { color: var(--forum-ink); }

  /* only the picked theme's screenshot, caption and URL show */
  [data-t] { display: none; }
  .tour:has([value='atmosphere']:checked) [data-t='atmosphere'],
  .tour:has([value='coral']:checked) [data-t='coral'],
  .tour:has([value='bulletin']:checked) [data-t='bulletin'],
  .tour:has([value='bubblegum']:checked) [data-t='bubblegum'],
  .tour:has([value='graphite']:checked) [data-t='graphite'],
  .tour:has([value='daydream']:checked) [data-t='daydream'],
  .tour:has([value='midnight']:checked) [data-t='midnight'],
  .tour:has([value='terminal']:checked) [data-t='terminal'],
  .tour:has([value='arcade']:checked) [data-t='arcade'] { display: revert; }
  .note { margin: 0; font: var(--type-meta); color: var(--forum-ink-faint); }

  @container (max-width: 520px) {
    .stage { aspect-ratio: 4 / 5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tcard, .tcard__check { transition: none; }
    .tcard:hover { translate: none; }
    .shot, .tcard:has(input:checked) .mf__btn { animation: none; }
  }
  }
</style>
