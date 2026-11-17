<script lang="ts">
  // Apps on the network riding three rings around the atmosphere mark. Angles
  // are where each one starts; the rings turn slowly unless motion is reduced.
  const satellites = [
    { slug: 'bluesky', ring: 1, angle: -40 },
    { slug: 'leaflet', ring: 1, angle: 140 },
    { slug: 'tangled', ring: 2, angle: 15 },
    { slug: 'grain', ring: 2, angle: 105 },
    { slug: 'spark', ring: 2, angle: 195 },
    { slug: 'surf', ring: 2, angle: 285 },
    { slug: 'bookhive', ring: 3, angle: -65 },
    { slug: 'pckt', ring: 3, angle: 55 },
    { slug: 'plyr.fm', ring: 3, angle: 160 },
    { slug: 'pdsls', ring: 3, angle: 240 },
  ];
</script>

<div class="orbit" aria-hidden="true">
  {#each [44, 67, 89, 120] as size}
    <span class="orbit__ring" style="--d: {size}cqi"></span>
  {/each}
  <span class="orbit__mark"><span class="orbit__glyph"></span></span>
  <span class="orbit__badge">
    <svg viewBox="0 0 16 14" shape-rendering="crispEdges">
      <g fill="var(--forum-accent-ink)">
        <rect x="2" y="0" width="12" height="1" /><rect x="1" y="1" width="14" height="7" />
        <rect x="2" y="8" width="12" height="1" /><rect x="3" y="9" width="6" height="1" /><rect x="3" y="10" width="3" height="1" />
      </g>
      <g fill="var(--forum-accent)">
        <rect x="3" y="2" width="9" height="1" /><rect x="3" y="4" width="9" height="1" /><rect x="3" y="6" width="6" height="1" />
      </g>
    </svg>
  </span>
  {#each satellites as app}
    <span class="sat sat--{app.ring}" style="--a: {app.angle}deg">
      <img src="/atmo/{app.slug}.svg" alt="" width="32" height="32" />
    </span>
  {/each}
</div>

<style>
  @property --spin {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }

  @layer atmobb {
  .orbit {
    --app-chip: #fff;
    position: relative;
    container-type: inline-size;
    aspect-ratio: 1;
    width: 100%;
    max-width: 520px;
    justify-self: center;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 20%, color-mix(in oklch, var(--forum-accent) 45%, transparent) 0 3px, transparent 4px),
      radial-gradient(circle at 80% 78%, color-mix(in oklch, var(--forum-accent) 35%, transparent) 0 4px, transparent 5px),
      var(--forum-accent-soft);
    border: 1px dashed color-mix(in oklch, var(--forum-accent) 65%, var(--forum-line));
    border-radius: var(--radius-lg);
  }
  @media (prefers-color-scheme: dark) {
    .orbit { --app-chip: #e8edf3; }
  }
  .orbit__ring {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--d);
    height: var(--d);
    translate: -50% -50%;
    border: 1px solid color-mix(in oklch, var(--forum-accent) 45%, transparent);
    border-radius: 50%;
  }
  .orbit__mark {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 25cqi;
    height: 25cqi;
    translate: -50% -50%;
    background: var(--forum-surface);
    border: 2px solid var(--forum-accent);
    border-radius: 50%;
    box-shadow: var(--shadow-md);
  }
  .orbit__glyph {
    width: 58%;
    height: 58%;
    background: var(--forum-ink);
    mask: url('/atmo/atmosphere-mark.svg') center / contain no-repeat;
  }
  .orbit__badge {
    position: absolute;
    left: calc(50% + 6.5cqi);
    top: calc(50% + 6cqi);
    z-index: 3;
    display: grid;
    place-items: center;
    width: 9.5cqi;
    height: 9.5cqi;
    background: var(--forum-accent);
    border: 2px solid var(--forum-surface);
    border-radius: 50%;
  }
  .orbit__badge svg { width: 56%; height: auto; }
  .sat {
    --turn: calc(var(--a) + var(--spin));
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 11cqi;
    height: 11cqi;
    background: var(--app-chip);
    border: 1px solid var(--forum-line-strong);
    border-radius: 50%;
    box-shadow: var(--shadow-sm);
    transform: translate(-50%, -50%) rotate(var(--turn)) translateX(var(--r)) rotate(calc(-1 * var(--turn)));
  }
  .sat img { width: 64%; height: 64%; }
  .sat--1 { --r: 22cqi; animation: spin 150s linear infinite; }
  .sat--2 { --r: 33.5cqi; animation: spin 220s linear infinite reverse; }
  .sat--3 { --r: 44.5cqi; animation: spin 300s linear infinite; }
  @keyframes spin { to { --spin: 360deg; } }
  @media (prefers-reduced-motion: reduce) {
    .sat { animation: none; }
  }
  }
</style>
