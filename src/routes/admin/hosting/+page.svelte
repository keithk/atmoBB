<script lang="ts">
  import { relTime } from '$lib/reltime';

  let { data, form } = $props();

  const open = $derived(data.requests.filter((r) => r.status !== 'rejected'));
  const unused = $derived(data.invites.filter((i) => !i.usedAt));
</script>

{#if form?.approved}<p class="atm-ok">Approved. The site is building; this page flips it to live when it's up.</p>{/if}
{#if form?.invited}<p class="atm-ok">New invite code: <code>{form.invited}</code></p>{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card">
  <div class="atm-card__header"><span>Forum requests</span></div>
  <div class="atm-card__body rows">
    {#each open as r (r.id)}
      <div class="reqrow">
        <div class="reqrow__who">
          <strong>{r.subdomain}.{data.suffix}</strong>
          <span class="hosting__meta">
            forum @{r.forumHandle} · requested by @{r.requesterHandle} · {relTime(r.createdAt)}
          </span>
          {#if r.status === 'failed' && r.error}
            <span class="hosting__error">{r.error}</span>
          {/if}
        </div>
        <div class="reqrow__acts">
          {#if r.status === 'pending' || r.status === 'failed'}
            <form method="POST" action="?/approve">
              <input type="hidden" name="id" value={r.id} />
              <button class="atm-btn atm-btn--primary atm-btn--sm">
                {r.status === 'failed' ? 'retry' : 'approve'}
              </button>
            </form>
            <form method="POST" action="?/reject">
              <input type="hidden" name="id" value={r.id} />
              <button class="atm-btn atm-btn--ghost atm-btn--sm">reject</button>
            </form>
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
  .reqrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .reqrow__who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .reqrow__acts { display: flex; gap: var(--space-2); align-items: center; }
  .hosting__invites {
    margin-top: var(--space-5);
  }
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
