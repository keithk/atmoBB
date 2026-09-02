<script lang="ts">
  import { onMount } from 'svelte';
  import AtmosphereExplainer from './AtmosphereExplainer.svelte';

  const alternatives = [
    { slug: 'leaflet', name: 'Leaflet' },
    { slug: 'surf', name: 'Surf' },
    { slug: 'spark', name: 'Spark' },
    { slug: 'pckt', name: 'pckt' },
    { slug: 'pdsls', name: 'PDSls' },
    { slug: 'plyr.fm', name: 'plyr.fm' },
    { slug: 'tangled', name: 'Tangled' },
    { slug: 'bookhive', name: 'BookHive' },
    { slug: 'grain', name: 'Grain' },
  ];
  let featuredApp = $state(alternatives[0]);

  // Keep SSR stable, then rotate the example once the card reaches the browser.
  onMount(() => {
    featuredApp = alternatives[Math.floor(Math.random() * alternatives.length)];
  });
</script>

<section class="atm-card atm-card--edge join">
  <div class="join__art" aria-hidden="true">
    <span class="join__orbit join__orbit--one"></span>
    <span class="join__orbit join__orbit--two"></span>
    <span class="join__mark">
      <img src="/atmo/atmosphere-mark.svg" alt="" width="48" height="48" />
    </span>
    <span class="join__reply">↩</span>
  </div>

  <div class="join__content">
    <div class="atm-eyebrow atm-eyebrow--accent join__eyebrow">have something to add?</div>
    <h3 class="join__title">Jump into the conversation.</h3>
    <p class="join__body">
      Already use <strong>Bluesky, {featuredApp.name}, or another app on the network?</strong>
      You already have an atmosphere account. Log in with it here to add your
      reply—there's no separate forum account to create.
    </p>

    <div class="join__actions">
      <a class="atm-btn atm-btn--primary atm-btn--lg" href="/login">log in &amp; reply →</a>
      <a
        class="join__apps"
        href="https://atstore.fyi/"
        target="_blank"
        rel="noopener"
        aria-label="Browse more apps on AT Store"
      >
        <span class="join__appstack" aria-hidden="true">
          <span class="join__app"><img src="/atmo/bluesky.svg" alt="" width="28" height="28" /></span>
          <span class="join__app"><img src="/atmo/{featuredApp.slug}.svg" alt="" width="28" height="28" /></span>
          <span class="join__app join__app--more">+</span>
        </span>
        <span>explore more apps on AT Store ↗</span>
      </a>
    </div>

    <div class="join__more">
      <AtmosphereExplainer />
    </div>
  </div>
</section>

<style>
  @layer atmobb {
  .join {
    position: relative;
    display: grid;
    grid-template-columns: 132px minmax(0, 1fr);
    max-width: 72ch;
    margin-top: var(--space-6);
    background:
      linear-gradient(125deg, var(--forum-surface) 55%, color-mix(in oklch, var(--forum-accent-soft) 65%, var(--forum-surface)));
  }
  .join__art {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 100%;
    overflow: hidden;
    color: var(--forum-link);
    background:
      radial-gradient(circle at 20% 22%, color-mix(in oklch, var(--forum-accent) 45%, transparent) 0 3px, transparent 4px),
      radial-gradient(circle at 78% 76%, color-mix(in oklch, var(--forum-accent) 35%, transparent) 0 4px, transparent 5px),
      var(--forum-accent-soft);
    border-right: 1px dashed color-mix(in oklch, var(--forum-accent) 65%, var(--forum-line));
  }
  .join__mark {
    z-index: 1;
    display: grid;
    place-items: center;
    width: 82px;
    height: 82px;
    background: var(--forum-surface);
    border: var(--border-solid) solid var(--forum-accent);
    border-radius: var(--radius-round);
    box-shadow: var(--shadow-md);
  }
  .join__mark img { width: 48px; height: 48px; }
  .join__reply {
    position: absolute;
    z-index: 2;
    top: calc(50% + 24px);
    left: calc(50% + 25px);
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    color: var(--forum-accent-ink);
    background: var(--forum-accent);
    border: var(--border-solid) solid var(--forum-surface);
    border-radius: var(--radius-round);
    font: var(--w-bold) var(--text-md)/1 var(--font-body);
  }
  .join__orbit {
    position: absolute;
    border: 1px solid color-mix(in oklch, var(--forum-accent) 45%, transparent);
    border-radius: var(--radius-round);
  }
  .join__orbit--one { width: 116px; height: 116px; }
  .join__orbit--two { width: 154px; height: 154px; }
  .join__content { padding: var(--space-6); }
  .join__eyebrow { margin-bottom: var(--space-2); }
  .join__title {
    margin: 0 0 var(--space-2);
    color: var(--forum-ink);
    font: var(--w-regular) var(--text-xl)/var(--lh-snug) var(--font-display);
    letter-spacing: var(--ls-tight);
  }
  .join__body {
    max-width: 56ch;
    margin: 0;
    color: var(--forum-ink-soft);
    font: var(--type-ui);
  }
  .join__body strong { color: var(--forum-ink); }
  .join__actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }
  .join__apps {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--forum-ink-faint);
    font: var(--type-meta);
    text-decoration: none;
  }
  .join__apps:hover { color: var(--forum-link); text-decoration: underline; }
  .join__appstack { display: flex; padding-left: 8px; }
  .join__app {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin-left: -8px;
    background: var(--forum-surface);
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-round);
    box-shadow: var(--shadow-sm);
  }
  .join__app img { width: 22px; height: 22px; }
  .join__app--more {
    color: var(--forum-link);
    background: var(--forum-accent-soft);
    font: var(--w-bold) var(--text-md)/1 var(--font-body);
  }
  .join__more {
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: 1px dashed var(--forum-line-strong);
  }

  @media (max-width: 600px) {
    .join { grid-template-columns: 1fr; }
    .join__art {
      min-height: 104px;
      border-right: 0;
      border-bottom: 1px dashed color-mix(in oklch, var(--forum-accent) 65%, var(--forum-line));
    }
    .join__mark { width: 64px; height: 64px; }
    .join__mark img { width: 38px; height: 38px; }
    .join__reply { top: calc(50% + 14px); left: calc(50% + 18px); }
    .join__orbit--one { width: 92px; height: 92px; }
    .join__orbit--two { width: 132px; height: 132px; }
    .join__content { padding: var(--space-5); }
  }

  @media (max-width: 400px) {
    .join__actions { align-items: stretch; }
    .join__actions > .atm-btn { width: 100%; }
  }
  }
</style>
