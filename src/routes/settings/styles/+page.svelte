<script lang="ts">
  import { enhance } from '$app/forms';
  import Card from '$lib/components/Card.svelte';
  import { THEME_PRESETS } from '$lib/themes';
  import type { PageProps } from './$types';
  let { data, form }: PageProps = $props();
  let scope = $state('forum');
  let saving = $state(false);
</script>

<Card title="Styles">
  <form method="POST" class="styles" use:enhance={() => {
    saving = true;
    return async ({ update }) => {
      try { await update({ reset: false }); } finally { saving = false; }
    };
  }}>
    <p>Choose how forums look to you. This does not change what other members see.</p>
    <label class="atm-field">
      <span class="atm-label">Apply to</span>
      <select class="atm-input" name="scope" bind:value={scope}>
        <option value="forum">This forum only — {data.forum.name}</option>
        <option value="all">All atmobb forums — account default</option>
      </select>
    </label>
    <label class="atm-field">
      <span class="atm-label">Theme</span>
      {#key `${scope}:${data.localTheme}:${data.globalTheme}`}
        <select class="atm-input" name="theme" value={scope === 'forum' ? data.localTheme : data.globalTheme} aria-describedby="theme-hint">
          {#if scope === 'forum'}<option value="inherit">Use my account default</option>{/if}
          <option value="">Forum’s own styling (no personal theme)</option>
          {#each THEME_PRESETS as preset}<option value={preset.value}>{preset.label}</option>{/each}
        </select>
      {/key}
      <span class="atm-hint" id="theme-hint">
        {#if scope === 'forum'}
          A choice here overrides your account default only on {data.forum.name}. Choose the forum’s own styling to keep its custom colors.
        {:else}
          Used on every forum unless you have a forum-specific choice. Existing forum choices stay unchanged.
        {/if}
        Personal themes replace colors, while keeping other forum custom styling. Save changes to apply.
      </span>
    </label>
    <div class="actions">
      <span role="status">
        {#if form?.message}<span class="atm-err">{form.message}</span>
        {:else if form?.saved}<span class="atm-ok">{form.scope === 'forum' ? 'Forum styles saved' : 'Account default saved'} ✓</span>{/if}
      </span>
      <button class="atm-btn atm-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
    </div>
  </form>
</Card>

<style>
  @layer atmobb {
    .styles { display: grid; gap: var(--space-4); }
    p { margin: 0; color: var(--forum-ink-soft); }
    .actions { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); border-top: var(--border-hair) solid var(--forum-line); padding-top: var(--space-4); }
  }
</style>
