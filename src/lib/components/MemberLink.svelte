<script module lang="ts">
  import type { ProfileCard } from '$lib/profile-card';
  // One in-flight/settled fetch per member, shared across every link on the page.
  const cardCache = new Map<string, Promise<ProfileCard | null>>();

  function loadCard(actor: string): Promise<ProfileCard | null> {
    let hit = cardCache.get(actor);
    if (!hit) {
      hit = fetch(`/members/${encodeURIComponent(actor)}/card.json`)
        .then((r) => (r.ok ? (r.json() as Promise<ProfileCard>) : null))
        .catch(() => null);
      cardCache.set(actor, hit);
    }
    return hit;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import ProfileHovercard from './ProfileHovercard.svelte';
  import { profileHref } from '$lib/profile-card';

  let {
    did,
    handle,
    class: klass = '',
    children,
  }: { did?: string; handle?: string; class?: string; children: Snippet } = $props();

  // A handle is enough (the card endpoint resolves it), so @-mentions that only
  // know the handle work too. Prefer the readable handle in the URL.
  const actor = $derived(handle ?? did ?? '');

  let card = $state<ProfileCard | null>(null);
  let open = $state(false);
  let coords = $state({ left: 0, top: 0, below: true });
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const CARD_W = 320;
  const CARD_H = 200;

  function place(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const below = r.bottom + CARD_H + 12 < window.innerHeight || r.top - CARD_H < 0;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - CARD_W - 8);
    const top = below ? r.bottom + 6 : r.top - CARD_H - 6;
    coords = { left, top, below };
  }

  function scheduleShow(e: { currentTarget: EventTarget | null }) {
    clearTimeout(hideTimer);
    const el = e.currentTarget as HTMLElement;
    showTimer = setTimeout(async () => {
      place(el);
      open = true;
      if (!card) card = await loadCard(actor);
    }, 220);
  }

  function scheduleHide() {
    clearTimeout(showTimer);
    hideTimer = setTimeout(() => (open = false), 160);
  }

  function stayOpen() {
    clearTimeout(hideTimer);
  }
</script>

<span class="atm-memberlink">
  <a
    href={profileHref(actor)}
    class={klass}
    onmouseenter={scheduleShow}
    onmouseleave={scheduleHide}
    onfocus={scheduleShow}
    onblur={scheduleHide}
  >{@render children()}</a>

  {#if open && card}
    <div
      class="atm-memberlink__pop"
      style="left:{coords.left}px;top:{coords.top}px"
      role="tooltip"
      onmouseenter={stayOpen}
      onmouseleave={scheduleHide}
    >
      <ProfileHovercard {card} />
    </div>
  {/if}
</span>

<style>
  @layer atmobb {
  .atm-memberlink { position: relative; }
  .atm-memberlink__pop {
    position: fixed;
    z-index: 60;
    animation: atm-memberlink-in var(--dur, 0.14s) var(--ease, ease) both;
  }
  @keyframes atm-memberlink-in {
    from { opacity: 0; transform: translateY(-3px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .atm-memberlink__pop { animation: none; }
  }
  }
</style>
