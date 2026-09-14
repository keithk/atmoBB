<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import RichTextEditor from '$lib/components/RichTextEditor.svelte';
  import { relTime } from '$lib/reltime';
  import { onMount } from 'svelte';

  let { data, form } = $props();

  const open = $derived(data.requests.filter((r) => r.status !== 'rejected'));
  const unused = $derived(data.invites.filter((i) => !i.usedAt));
  onMount(() => {
    const timer = setInterval(() => {
      if (data.fleet?.instances.some((instance) => instance.status === 'provisioning' || instance.update?.status === 'waiting' || instance.update?.status === 'running')) void invalidateAll();
    }, 5000);
    return () => clearInterval(timer);
  });
</script>

<p class="atm-hint hosting__optional">
  Hosting is optional. It's on here because this forum runs with <code>ATMOBB_HOSTING=1</code> (the hosting overlay sets
  it), so other people can request forums that you run for them. Most forums leave it off, and then neither this page
  nor <a href="/host">/host</a> exists.
</p>

{#if form?.pageSaved}<p class="atm-ok">Hosting page saved.</p>{/if}
{#if form?.approved}<p class="atm-ok">Approved. The site is building; this page flips it to live when it's up.</p>{/if}
{#if form?.invited}<p class="atm-ok">New invite code: <code>{form.invited}</code></p>{/if}
{#if form?.capacityUpdated}<p class="atm-ok">Fleet capacity updated.</p>{/if}
{#if form?.updateQueued}<p class="atm-ok">Instance update queued. Updates run one at a time across the host.</p>{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

{#if data.fleet}
  <div class="atm-card fleet">
    <div class="atm-card__header"><span>Isolated hosting fleet</span></div>
    <div class="atm-card__body rows">
      <form class="capacity" method="POST" action="?/capacity">
        <label class="atm-field">
          <span class="atm-label">Capacity ({data.fleet.used} used of {data.fleet.limit})</span>
          <input class="atm-input capacity__input" name="limit" type="number" min="0" max="1000" step="1" value={data.fleet.limit} required />
        </label>
        <button class="atm-btn atm-btn--primary atm-btn--sm">set capacity</button>
      </form>
      <p class="atm-hint fleet__note">Planning target: 2 GB RAM per instance (not benchmarked); disk needs are unknown. Provisioning and updates are serialized host-wide, so an instance may wait while another job finishes.</p>
      <p class="atm-hint fleet__note">The limit counts additional isolated forums, including failed provisions; lowering it does not stop existing forums. Main builds are unreleased and can exhaust host RAM or disk. Migrations may not be reversible.</p>

      {#each data.fleet.instances as instance (instance.id)}
        <section class="instance">
          <div class="instance__heading">
            <div>
              <strong>{instance.subdomain}.{data.suffix}</strong>
              <span class="hosting__meta">{instance.forumDid} · isolated · {instance.status}</span>
            </div>
            <a class="atm-linkbtn atm-btn--sm" href="https://{instance.subdomain}.{data.suffix}">open →</a>
          </div>
          {#if instance.error}<p class="hosting__error">Provisioning: {instance.error}</p>{/if}
          {#if instance.updateError}<p class="hosting__error">Update: {instance.updateError}</p>{/if}
          {#if instance.update}
            <div class="instance__update">
              <span class="hosting__meta">
                Installed: {instance.update.installedVersion ?? 'unknown'}{#if instance.update.installedCommit} · <code>{instance.update.installedCommit}</code>{/if}
                · update {instance.update.status}{#if instance.update.target} ({instance.update.target}){/if}
              </span>
              {#if instance.update.message}<p class:hosting__error={instance.update.status === 'failed'}>{instance.update.message}</p>{/if}
              {#if instance.update.backup}<p class="hosting__meta">Backup: <code>{instance.update.backup}</code></p>{/if}
              {#if instance.update.log?.length}
                <details class="instance__log" open={instance.update.status === 'failed'}>
                  <summary>Update log</summary>
                  <pre>{instance.update.log.join('\n')}</pre>
                </details>
              {/if}
            </div>
          {/if}
          <div class="instance__controls">
            <form method="POST" action="?/update">
              <input type="hidden" name="id" value={instance.id} />
              <input type="hidden" name="target" value="stable" />
              <button class="atm-btn atm-btn--primary atm-btn--sm" disabled={instance.status !== 'live' || !instance.update || instance.update.status === 'waiting' || instance.update.status === 'running'}>update stable</button>
            </form>
            <form class="main-update" method="POST" action="?/update">
              <input type="hidden" name="id" value={instance.id} />
              <input type="hidden" name="target" value="main" />
              <input class="atm-input" name="confirmation" placeholder="type main" aria-label="Type main to confirm" required autocomplete="off" />
              <button class="atm-btn atm-btn--ghost atm-btn--sm" disabled={instance.status !== 'live' || !instance.update || instance.update.status === 'waiting' || instance.update.status === 'running'}>update main</button>
            </form>
          </div>
        </section>
      {:else}
        <p class="atm-empty atm-empty--bare">No isolated instances yet.</p>
      {/each}
    </div>
  </div>
{:else if data.fleetError}
  <p class="atm-err">Isolated fleet status unavailable: {data.fleetError}</p>
{/if}

<div class="atm-card">
  <div class="atm-card__header"><span>Forum requests</span></div>
  <div class="atm-card__body rows">
    {#each open as r (r.id)}
      <div class="reqrow">
        <div class="reqrow__who">
          <strong>{r.subdomain}.{data.suffix}</strong>
          <span class="hosting__meta">
            forum @{r.forumHandle} · requested by @{r.requesterHandle} · {relTime(r.createdAt)} · {r.siteId ? 'legacy shared hosting' : 'isolated fleet'}
          </span>
          {#if r.about || r.aboutUrl}
            <span class="reqrow__about">
              {#if r.about}{r.about}{/if}
              {#if r.aboutUrl}<a href={r.aboutUrl} rel="noopener noreferrer nofollow" target="_blank">{r.aboutUrl}</a>{/if}
            </span>
          {/if}
          {#if r.status === 'failed' && r.error}
            <span class="hosting__error">{r.error}</span>
          {/if}
        </div>
        <div class="reqrow__acts">
          {#if r.status === 'pending' || (r.status === 'failed' && !r.siteId)}
            <form method="POST" action="?/approve">
              <input type="hidden" name="id" value={r.id} />
              <button class="atm-btn atm-btn--primary atm-btn--sm">
                {r.status === 'failed' ? 'retry' : 'approve'}
              </button>
            </form>
            {#if r.status === 'pending' && !r.isolated && !r.siteId}<form method="POST" action="?/reject">
              <input type="hidden" name="id" value={r.id} />
              <button class="atm-btn atm-btn--ghost atm-btn--sm">reject</button>
            </form>{/if}
          {:else if r.status === 'failed' && r.siteId}
            <span class="hosting__meta">Legacy instance cannot be retried in the isolated fleet.</span>
          {:else if r.status === 'provisioning'}
            <span class="atm-chip admin__chip--dev">building…</span>
          {:else if r.status === 'live'}
            <a class="atm-linkbtn atm-btn--sm" href="https://{r.subdomain}.{data.suffix}">open →</a>
          {/if}
        </div>
      </div>
    {:else}
      <p class="atm-empty atm-empty--bare">No requests yet. Hand out an invite code.</p>
    {/each}
  </div>
</div>

<div class="atm-card hosting__page">
  <div class="atm-card__header"><span>Hosting page</span></div>
  <div class="atm-card__body">
    <form class="atm-editform" method="POST" action="?/page">
      <div class="atm-field">
        <span class="atm-label">Heading</span>
        <input class="atm-input" name="heading" maxlength="100" value={data.page.heading} placeholder="Host a forum" />
      </div>
      <div class="atm-field">
        <span class="atm-label">What people read on <a href="/host">/host</a></span>
        <RichTextEditor name="body" placeholder="Who this hosting is for, what you promise, what it costs you…" initial={data.pageDoc} allowImages={false} />
        <span class="atm-hint">Leave it empty to show the built-in explanation. The request form always appears below it.</span>
      </div>
      <label class="hosting__check">
        <input type="checkbox" name="requireInvite" checked={data.page.requireInvite} />
        <span>
          <b>Require an invite code</b>
          <small>Off, anyone logged in can send a request. You still approve every one, and capacity still applies.</small>
        </span>
      </label>
      <div class="atm-editform__actions">
        <button class="atm-btn atm-btn--primary atm-btn--sm">save page</button>
      </div>
    </form>
  </div>
</div>

<div class="atm-card hosting__invites">
  <div class="atm-card__header"><span>Invite codes ({unused.length} unused)</span></div>
  <div class="atm-card__body rows">
    {#each data.invites as invite (invite.code)}
      <div class="hosting__invite">
        <code>{invite.code}</code>
        <span class="hosting__meta">
          {#if invite.usedAt}used {relTime(invite.usedAt)}{:else}unused{/if}
          {#if invite.note} · {invite.note}{/if}
        </span>
      </div>
    {/each}
    <form class="atm-editform hosting__mint" method="POST" action="?/invite">
      <div class="atm-field">
        <span class="atm-label">Note (who it's for)</span>
        <input class="atm-input" name="note" maxlength="100" />
      </div>
      <div class="atm-editform__actions">
        <button class="atm-btn atm-btn--primary atm-btn--sm">new invite</button>
      </div>
    </form>
  </div>
</div>

<style>
  .rows { display: grid; gap: var(--space-2); }
  .fleet { margin-bottom: var(--space-5); }
  .fleet__note { margin: 0 0 var(--space-2); max-width: 72ch; }
  .capacity { display: flex; align-items: end; gap: var(--space-2); flex-wrap: wrap; }
  .capacity__input { width: 9rem; }
  .instance { display: grid; gap: var(--space-2); padding: var(--space-3) 0; border-top: var(--border-hair) solid var(--forum-line); }
  .instance__heading { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
  .instance__heading > div, .instance__update { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
  .instance__controls, .main-update { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
  .main-update .atm-input { width: 9rem; }
  .instance__log { color: var(--forum-ink-soft); }
  .instance__log summary { cursor: pointer; font: var(--type-ui); }
  .instance__log pre { max-height: 18rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: var(--space-3); background: var(--forum-surface-1); border-radius: var(--radius-md); font: var(--type-meta); }
  .reqrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .reqrow__who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .reqrow__acts { display: flex; gap: var(--space-2); align-items: center; }
  .hosting__optional { margin: 0 0 var(--space-4); max-width: 72ch; }
  .reqrow__about { display: flex; flex-direction: column; gap: 2px; font: var(--type-meta); overflow-wrap: anywhere; }
  .hosting__page,
  .hosting__invites {
    margin-top: var(--space-5);
  }
  .hosting__check { display: flex; gap: 6px; align-items: flex-start; font: var(--type-ui); }
  .hosting__check input { margin-top: 4px; }
  .hosting__check span { display: grid; gap: 2px; }
  .hosting__check b { font-weight: var(--w-semibold); }
  .hosting__invite {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }
  .hosting__meta {
    color: var(--forum-ink-soft);
    font: var(--type-meta);
  }
  .hosting__error {
    display: block;
    color: var(--danger-1);
    font: var(--type-meta);
  }
  .hosting__mint {
    margin-top: var(--space-4);
  }
</style>
