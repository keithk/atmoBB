<script lang="ts">
  import { page } from '$app/state';
  import Avatar from '$lib/components/Avatar.svelte';

  let { data, form } = $props();

  const saved = $derived(page.url.searchParams.has('saved'));
  const pending = $derived(page.url.searchParams.has('pending'));
  const name = (s: { subject: string; subjectProfile?: { displayName?: string } }) =>
    s.subjectProfile?.displayName ?? data.staffHandles[s.subject] ?? s.subject.slice(8, 20);
  const boardName = (uri: string) => data.boards.find((b) => b.uri === uri)?.name ?? uri.split('/').pop();
  const scope = (boards: string[]) => boards.map(boardName).join(', ');

  // The scope picker only applies to moderators; admins always cover everything.
  let role = $state('moderator');
</script>

{#if pending}
  <p class="atm-ok">Saved. The change is taking a few extra seconds to show up here — refresh to see it.</p>
{:else if saved}
  <p class="atm-ok">Saved.</p>
{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card panel">
  <div class="atm-card__header"><span>Staff</span></div>
  <div class="atm-card__body">
    {#each data.staff as s}
      <div class="grant">
        <Avatar seed={s.subject} size={28} />
        <div class="grant__who">
          <span class="grant__name">{name(s)}</span>
          <code class="grant__handle">@{data.staffHandles[s.subject] ?? s.subject}</code>
        </div>
        <span class="atm-chip grant__role grant__role--{s.role}">{s.role}</span>
        {#if s.boards?.length}
          <span class="grant__scope" title={scope(s.boards)}>{scope(s.boards)}</span>
        {:else}
          <span class="grant__scope">whole forum</span>
        {/if}
        <form method="POST" action="?/remove">
          <input type="hidden" name="uri" value={s.uri} />
          <button class="atm-btn atm-btn--ghost atm-btn--sm">remove</button>
        </form>
      </div>
    {:else}
      <p class="atm-empty atm-empty--bare">No staff members yet.</p>
    {/each}

    <form class="add" method="POST" action="?/add">
      <div class="add__row">
        <input class="atm-input" name="handle" required placeholder="their.handle"
          autocapitalize="none" autocorrect="off" spellcheck="false" />
        <select class="atm-select" name="role" bind:value={role}>
          <option value="moderator">moderator</option>
          <option value="admin">admin</option>
        </select>
        <button class="atm-btn atm-btn--primary atm-btn--sm">add to staff</button>
      </div>
      {#if role === 'moderator' && data.boards.length}
        <details class="add__scope">
          <summary>Limit to certain boards</summary>
          <p class="atm-hint">Leave every box unchecked for a moderator who covers the whole forum.</p>
          <div class="add__boards">
            {#each data.boards as b}
              <label class="add__board" class:add__board--sub={!!b.parent}>
                <input type="checkbox" name="boards" value={b.uri} /> {b.name}
              </label>
            {/each}
          </div>
        </details>
      {/if}
    </form>
    <p class="atm-hint add-note">
      Staff roles are stored in the forum account. A moderator can be limited to
      some boards; admins always cover the whole forum.
    </p>
  </div>
</div>

<style>
  .panel { max-width: 72ch; }
  .grant {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .grant__who { display: grid; flex: 1; min-width: 0; }
  .grant__name { font: var(--w-semibold) var(--text-sm)/1.3 var(--font-body); color: var(--forum-ink); }
  .grant__handle { font: var(--type-handle); color: var(--forum-ink-faint); }
  /* squared off, with a role-colored admin variant */
  .grant__role { border-radius: var(--radius-sm); }
  .grant__role--admin {
    color: var(--forum-rank);
    border-color: color-mix(in oklch, currentColor 45%, transparent);
  }
  .grant__scope {
    font: var(--type-meta);
    color: var(--forum-ink-soft);
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .add { display: grid; gap: var(--space-2); margin-top: var(--space-4); }
  .add__row { display: flex; gap: var(--space-2); }
  .add .atm-input { flex: 1; min-width: 0; }
  .add .atm-select { flex: none; width: auto; }
  .add__scope summary { cursor: pointer; font: var(--type-meta); color: var(--forum-ink-soft); }
  .add__boards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16ch, 1fr));
    gap: var(--space-1) var(--space-3);
    margin-top: var(--space-2);
  }
  .add__board { font: var(--text-sm)/1.4 var(--font-body); }
  .add__board--sub { padding-left: var(--space-3); }
  .add-note { margin-top: var(--space-3); }
</style>
