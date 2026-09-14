<script lang="ts">
  // An extension's panel: its UI in a frame sandboxed to scripts only, so it
  // runs in an opaque origin with no view of this page, its cookies, or the
  // session. It reaches the extension only through the bridge, which forwards
  // its actions to the action endpoint as whoever is signed in. The name and
  // endorsement label are drawn here, outside the frame, so an extension can't
  // dress itself up as the forum.
  import { onMount } from 'svelte';
  import { createPanelBridge, type ActionOutcome, type PanelMode } from '$lib/extensions/bridge';

  interface Props {
    installId: string;
    name: string;
    /** The UI entry's path below the install's frame route. */
    entry: string;
    mode: PanelMode;
    /** The thread's at-uri, on a bound thread or the attach page. */
    thread?: string | null;
    signedIn: boolean;
    /** On the extension's own page, the path after its page address. */
    path?: string;
    endorsement?: 'endorsed' | 'unverified';
    /** Attach mode: the setup the extension's attach form collected. */
    onattach?: (params: unknown) => void;
  }

  let { installId, name, entry, mode, thread = null, signedIn, path = '', endorsement = 'unverified', onattach }: Props = $props();

  let container = $state<HTMLDivElement>();
  let height = $state(240);
  let closed = $state(false);

  async function runAction(action: string, input: unknown): Promise<ActionOutcome> {
    const response = await fetch(`/x/${installId}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      // Only a bound thread's panel acts for its thread; the attach form acts before there is a binding.
      body: JSON.stringify({ thread: mode === 'thread' ? thread : null, action, input }),
    });
    const body = await response.json().catch(() => null);
    if (response.ok) return { ok: true, value: body?.value ?? null };
    return {
      ok: false,
      error: {
        code: typeof body?.code === 'string' ? body.code : 'failed',
        message: typeof body?.message === 'string' ? body.message : 'The action failed.',
      },
    };
  }

  onMount(() => {
    // Built by hand rather than in markup so the sandbox is in place before
    // the frame's first navigation and the load listener sees its first load.
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = `${name} panel`;
    frame.className = 'atm-extension__frame';

    const bridge = createPanelBridge({
      mode,
      thread,
      signedIn,
      path,
      frame: () => frame.contentWindow,
      runAction,
      attach: onattach,
      resize: (next) => (height = next),
      teardown: () => {
        frame.remove();
        closed = true;
      },
    });
    const onMessage = (event: MessageEvent) => bridge.message(event);
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => bridge.load());
    frame.src = `/x/${encodeURIComponent(installId)}/frame/${entry.split('/').map(encodeURIComponent).join('/')}`;
    container?.append(frame);

    return () => {
      bridge.close();
      window.removeEventListener('message', onMessage);
      frame.remove();
    };
  });
</script>

<section class="atm-card atm-card--edge atm-extension" aria-label="{name} extension">
  <div class="atm-card__header atm-extension__header">
    <span class="atm-extension__name">{name}</span>
    {#if endorsement === 'endorsed'}
      <span class="atm-chip atm-chip--ok">endorsed extension</span>
    {:else}
      <span class="atm-chip atm-chip--warn" title="The atmoBB directory hasn't reviewed this release. It runs sandboxed: it sees who you are when you use it, but never your login.">unverified extension</span>
    {/if}
  </div>
  {#if closed}
    <p class="atm-card__body atm-hint">This panel tried to leave its frame, so it was closed. Reload the page to open it again.</p>
  {:else}
    <div class="atm-extension__body" style:height="{height}px" bind:this={container}>
      <noscript><p class="atm-card__body atm-hint">This extension's panel needs JavaScript.</p></noscript>
    </div>
  {/if}
</section>

<style>
  @layer atmobb {
  .atm-extension__name { font: var(--type-section); color: var(--forum-ink); }
  .atm-extension__body { background: var(--forum-surface); }
  .atm-extension__body :global(.atm-extension__frame) { display: block; width: 100%; height: 100%; border: 0; }
  }
</style>
