<script lang="ts">
  const apps = [
    { slug: 'bluesky', name: 'Bluesky' },
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
</script>

<details class="atmo">
  <summary>What's an atmosphere account?</summary>
  <div class="atm-card atm-card--edge atmo__panel">
    <p>
      It's an account that works across
      <a href="https://bsky.app/" target="_blank" rel="noopener">Bluesky</a>,
      <a href="https://leaflet.pub/" target="_blank" rel="noopener">Leaflet</a>,
      and other apps on the same network. You can use that account here too.
    </p>
    <div class="atm-eyebrow atmo__heading">some apps on the network</div>
    <div class="atmo__apps">
      {#each apps as app}
        <span class="atmo__app" title={app.name}>
          <img src="/atmo/{app.slug}.svg" alt="" loading="lazy" width="32" height="32" />
          <span class="atmo__name">{app.name}</span>
        </span>
      {/each}
    </div>
    <a class="atm-btn atm-btn--secondary atmo__cta" href="https://bsky.app/" target="_blank" rel="noopener">
      <img src="/atmo/bluesky.svg" alt="" width="16" height="16" />
      create an account on Bluesky →
    </a>
  </div>
</details>

<style>
  @layer atmobb {
  .atmo summary {
    cursor: pointer;
    font: var(--w-semibold) var(--text-sm)/1.4 var(--font-body);
    color: var(--forum-link);
    text-decoration: underline;
    text-underline-offset: 3px;
    width: fit-content;
  }
  .atmo summary:hover { color: var(--forum-link-hover); }
  .atmo__panel {
    margin-top: var(--space-3);
    padding: var(--space-5);
  }
  .atmo__panel p { font: var(--type-ui); color: var(--forum-ink); }
  .atmo__heading { margin-bottom: var(--space-3); }
  .atmo__apps {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .atmo__app {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: var(--space-3) var(--space-2);
    background: var(--forum-surface-2);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
  }
  .atmo__app img { width: 32px; height: 32px; }
  .atmo__name { font: var(--w-semibold) var(--text-2xs)/1 var(--font-body); color: var(--forum-ink-soft); }
  .atmo__cta { width: fit-content; }
  .atmo__cta img { width: 16px; height: 16px; }
  @media (max-width: 480px) {
    .atmo__cta { width: 100%; white-space: normal; line-height: 1.3; text-align: center; }
  }
  }
</style>
