<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';

  let { data, form } = $props();
  const operationsBlocked = $derived(data.status?.status === 'waiting' || data.status?.status === 'running' || data.status?.maintenance);
  onMount(() => {
    if (data.status?.status !== 'waiting' && data.status?.status !== 'running') return;
    const timer = setInterval(() => void invalidateAll(), 3000);
    return () => clearInterval(timer);
  });
</script>

{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card updates">
  <div class="atm-card__header"><span>Software updates</span></div>
  <div class="atm-card__body update">
    <div>
      <span class="atm-label">Installed</span>
      <p class="version">
        atmobb {data.status?.installedVersion ?? data.currentVersion}
        {#if data.status?.installedCommit}<code class="commit">{data.status.installedCommit}</code>{/if}
      </p>
    </div>

    {#if data.status?.status === 'waiting'}
      <p class="atm-ok update__status">Update queued for the host-wide updater…</p>
    {:else if data.status?.status === 'running'}
      <p class="atm-ok update__status">The host updater is running. Maintenance begins after image preparation, before writes stop and backups begin.</p>
    {:else if data.status?.status === 'failed'}
      <div class="failure">
        <p class="failure__title">Update failed</p>
        <p>{data.status.message}</p>
        <p>Review the log below, then run <code>./atmobb status</code> from this forum's bundle directory on the host. Forward-only Happyview migrations are not automatically rolled back.</p>
        {#if data.status.backup}<p>Pre-migration backup: <code>{data.status.backup}</code></p>{/if}
      </div>
    {:else if data.status?.status === 'succeeded'}
      <p class="atm-ok update__status">Last operation finished successfully.</p>
    {/if}
    {#if data.status?.candidateVersion}
      <p class="atm-hint update__status">Selected target: atmobb {data.status.candidateVersion}{#if data.status.candidateCommit} at <code>{data.status.candidateCommit}</code>{/if}</p>
    {/if}
    {#if data.statusError}<p class="atm-err update__status">{data.statusError}</p>{/if}

    {#if data.enabled && data.status}
      <form method="POST" action="?/stable">
        <button class="atm-btn atm-btn--primary" disabled={operationsBlocked}>update to latest stable release</button>
      </form>
      <p class="atm-hint">Prepares the verified release, enables maintenance, stops writes, backs up the forum, then applies migrations and setup. The forum reopens only after target-version health checks pass.</p>
      <form method="POST" action="?/console">
        <button class="atm-btn atm-btn--ghost">open update and recovery console</button>
      </form>
      <p class="atm-hint">Updates continue in a protected console that stays available while the forum is offline. Console access lasts 12 hours; host CLI recovery remains available after it expires.</p>
    {:else if !data.enabled}
      <p class="atm-hint update__status">Updates from this page need a release-bundle installation with the host updater. A bundle installed before Admin → Updates existed gets it by rerunning <code>./atmobb install</code> in its bundle directory. Source installs and other deployments update the way they were set up; see <a href="https://github.com/keithk/atmoBB/blob/main/docs/self-hosting.md#upgrades">Upgrades</a>.</p>
    {/if}
  </div>
</div>

{#if data.enabled && data.status}
  <div class="atm-card maintenance">
    <div class="atm-card__header"><span>Maintenance mode</span></div>
    <div class="atm-card__body update">
      <p class="update__status">Temporarily close this forum without installing an update. Visitors receive a maintenance response and cannot submit writes.</p>
      <form method="POST" action="?/maintenance">
        <button class="atm-btn atm-btn--ghost" disabled={operationsBlocked}>enable maintenance</button>
      </form>
      <p class="atm-hint">The recovery console stays open. Disabling maintenance reruns setup and health checks before reopening the forum.</p>
    </div>
  </div>
{/if}

{#if data.enabled && data.status}
  <details class="advanced">
    <summary>Advanced options</summary>
    <div class="advanced__body">
      <strong>Danger: build and run unreleased <code>main</code></strong>
      <p>Main is not a release. It may be broken, may run forward-only migrations, and may be unsafe to roll back. Building on this host consumes substantial time, memory, and disk and can fail or degrade a small VPS. A failed build leaves the current containers running.</p>
      <form class="advanced__form" method="POST" action="?/main">
        <label class="atm-field">
          <span class="atm-label">Type <code>main</code> to confirm</span>
          <input class="atm-input" name="confirmation" required autocomplete="off" />
        </label>
        <button class="atm-btn atm-btn--ghost" disabled={operationsBlocked}>resolve and build main</button>
      </form>
    </div>
  </details>
{/if}

{#if data.status?.log?.length}
  <details class="log" open={data.status.status === 'failed'}>
    <summary>Update log</summary>
    <pre>{data.status.log.join('\n')}</pre>
  </details>
{/if}

<style>
  .updates, .maintenance, .advanced, .log { max-width: 72ch; }
  .maintenance { margin-top: var(--space-5); }
  .update { display: grid; gap: var(--space-4); }
  .version { margin: var(--space-1) 0 0; display: flex; align-items: center; gap: var(--space-2); }
  .commit { min-width: 0; overflow-wrap: anywhere; }
  .update__status, .failure p { margin: 0; }
  .failure { display: grid; gap: var(--space-2); padding: var(--space-3); border: var(--border-hair) solid var(--danger-1); border-radius: var(--radius-md); }
  .failure__title { color: var(--danger-1); font-weight: var(--w-semibold); }
  .advanced__body > strong { color: var(--danger-1); }
  .advanced, .log { margin-top: var(--space-5); color: var(--forum-ink-soft); }
  .advanced > summary, .log > summary { cursor: pointer; font: var(--type-ui); }
  .advanced__body { margin-top: var(--space-3); padding: var(--space-4); border: var(--border-hair) solid color-mix(in oklch, var(--danger-1) 45%, var(--forum-line)); border-radius: var(--radius-md); background: var(--forum-surface-1); }
  .advanced__body > p { font: var(--type-ui); }
  .advanced__form { display: grid; gap: var(--space-3); }
  .advanced__form .atm-btn { justify-self: start; color: var(--danger-1); }
  .log pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: var(--space-3); background: var(--forum-surface-1); border-radius: var(--radius-md); font: var(--type-meta); }
</style>
