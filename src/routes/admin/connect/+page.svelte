<script lang="ts">
  let { data, form } = $props();
</script>

{#if data.error === 'wrong-account'}
  <p class="atm-err">
    That isn't the forum account (<code>{data.forumDid}</code>). Log in with the
    account that owns this forum's boards.
  </p>
{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<div class="atm-card panel">
  <div class="atm-card__header"><span>Forum account connection</span></div>
  <div class="atm-card__body">
    {#if data.writeMode === 'index'}
      <p class="status">
        In development mode, admin changes are written directly to the local
        index. No account connection is needed.
      </p>
    {:else if data.connected}
      <p class="status">
        Connected as <code>@{data.forumHandle}</code>. Admin changes are written
        to the forum's account through this session, which refreshes automatically.
        Reconnect below if changes stop saving.
      </p>
    {:else}
      <p class="status">
        To save boards, rules, and staff, connect the forum's atmosphere account.
        This won't change the account you're logged in with. The forum session is
        stored separately and used only for admin changes. The person who connects
        it becomes the first admin.
      </p>
    {/if}

    <form class="connect" method="POST" action="?/connect">
      <input
        class="atm-input"
        name="handle"
        placeholder="forum.handle"
        value={form?.handle ?? (data.forumHandle.startsWith('did:') ? '' : data.forumHandle)}
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        required
      />
      <button class="atm-btn atm-btn--primary">
        {data.connected ? 'reconnect forum account →' : 'connect forum account →'}
      </button>
    </form>
    <p class="atm-hint connect-note">
      The consent screen asks to manage the forum's profile, boards, categories,
      topics, staff, moderation, images, and fonts
      (<code>app.atmobb.authSysop</code>). It does not request access to your personal account.
    </p>
  </div>
</div>

<style>
  .panel { max-width: 62ch; }
  .status { font: var(--type-body); color: var(--forum-ink); margin: 0 0 var(--space-4); }
  .status code { font: var(--type-handle); }
  .connect { display: flex; gap: var(--space-2); }
  .connect .atm-input { flex: 1; }
  .connect-note { margin-top: var(--space-3); }
  .connect-note code { font: var(--type-handle); }
  .atm-err code { font: var(--type-handle); }
</style>
