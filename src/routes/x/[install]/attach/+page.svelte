<script lang="ts">
  import ExtensionPanel from '$lib/components/ExtensionPanel.svelte';
  import { page } from '$app/state';

  let { data } = $props();

  let attaching = $state(false);
  let outcome = $state<{ ok: boolean; message: string } | null>(null);

  // The extension's form sends its setup; atmoBB attaches it through the attach endpoint.
  async function attach(params: unknown) {
    if (attaching || outcome?.ok) return;
    attaching = true;
    outcome = null;
    try {
      const response = await fetch(`/x/${data.panel.installId}/attach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ thread: data.thread, params }),
      });
      const body = await response.json().catch(() => null);
      outcome = response.ok
        ? { ok: true, message: `${data.panel.name} is attached to the thread.` }
        : { ok: false, message: typeof body?.message === 'string' ? body.message : `${data.panel.name} couldn't be attached.` };
    } catch {
      outcome = { ok: false, message: "Couldn't reach the forum. Try again." };
    } finally {
      attaching = false;
    }
  }
</script>

<nav class="atm-crumbs atm-crumbs--spaced">
  <a href="/">{page.data.forum.name}</a><span class="atm-crumbs__sep">›</span>
  <a href={data.threadHref}>Thread</a><span class="atm-crumbs__sep">›</span>
  <span class="atm-crumbs__current">Attach {data.panel.name}</span>
</nav>

<div aria-live="polite">
  {#if attaching}
    <p class="atm-hint"><span class="atm-spinner" aria-hidden="true"></span> Attaching…</p>
  {:else if outcome?.ok}
    <p class="atm-ok">{outcome.message} <a href={data.threadHref}>Back to the thread</a></p>
  {:else if outcome}
    <p class="atm-err">{outcome.message}</p>
  {/if}
</div>

{#if !outcome?.ok}
  <ExtensionPanel {...data.panel} mode="attach" thread={data.thread} signedIn={true} onattach={attach} />
  <p class="atm-hint"><a href={data.threadHref}>Back to the thread</a> without attaching.</p>
{/if}
