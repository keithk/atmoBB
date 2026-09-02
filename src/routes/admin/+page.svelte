<script lang="ts">
  import { page } from '$app/state';

  let { data, form } = $props();

  const saved = $derived(page.url.searchParams.has('saved'));
  const pending = $derived(page.url.searchParams.has('pending'));
</script>

{#if pending}
  <p class="atm-ok">Saved. The change is taking a few extra seconds to show up here — refresh to see it.</p>
{:else if saved}
  <p class="atm-ok">Saved.</p>
{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card panel">
  <div class="atm-card__header"><span>Forum profile</span></div>
  <div class="atm-card__body">
    <form class="profile" method="POST" action="?/save">
      <div class="atm-field">
        <span class="atm-label">Name</span>
        <input class="atm-input" name="name" maxlength="100" required value={data.profile.name} />
      </div>
      <div class="atm-field">
        <span class="atm-label">Description</span>
        <input class="atm-input" name="description" maxlength="1000" value={data.profile.description}
          placeholder="What this place is about, in a sentence or two" />
      </div>
      <div class="atm-field">
        <span class="atm-label">Rules</span>
        <textarea class="atm-textarea" name="rules" rows="8"
          placeholder="One rule per paragraph; blank line between rules">{data.rulesText}</textarea>
        <span class="atm-hint">Rules are stored in the forum account so every appview uses the same version.</span>
      </div>
      <button class="atm-btn atm-btn--primary">save profile</button>
    </form>
  </div>
</div>

<style>
  .panel { max-width: 72ch; }
  .profile { display: grid; gap: var(--space-4); }
</style>
