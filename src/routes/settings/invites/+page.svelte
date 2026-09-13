<script lang="ts">
  import { enhance } from '$app/forms';
  import Card from '$lib/components/Card.svelte';
  import { relTime } from '$lib/reltime';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { message?: string; minted?: string; revoked?: boolean } | null } = $props();

  let copied = $state('');
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      copied = url;
    } catch {
      // The link is in a text field beside the button; selecting it still works.
    }
  }

  const stateLabel: Record<PageData['invites'][number]['state'], string> = {
    open: 'open',
    reserved: 'being redeemed',
    redeemed: 'used',
    revoked: 'withdrawn',
    expired: 'expired',
  };
</script>

<div class="wrap">
  <nav class="atm-crumbs">
    <a href="/settings/profile">edit profile</a><span class="atm-crumbs__sep">›</span>
    <span class="atm-crumbs__current">invites</span>
  </nav>

  <h1 class="title">Invites</h1>
  {#if data.joinMode === 'open'}
    <p class="lede">This forum is open to everyone, so invites are off. Anyone can join from the home page.</p>
  {:else}
    <p class="lede">
      Each link admits one person, expires after {data.days} day{data.days === 1 ? '' : 's'}, and records you as their sponsor.
      {#if data.staff}
        As staff you can mint as many as you need.
      {:else if data.cap === 0}
        Only staff can mint invites here.
      {:else}
        You can have {data.cap} open at a time.
      {/if}
    </p>
    {#if form?.message}<p class="atm-err">{form.message}</p>{/if}

    {#if form?.minted}
      <Card title="Your new invite">
        <p>Send this link to the person you're inviting. It's only shown here once, but stays in the list below while it's open.</p>
        <div class="link">
          <input class="atm-input" readonly value={form.minted} onfocus={(e) => e.currentTarget.select()} />
          <button type="button" class="atm-btn atm-btn--secondary atm-btn--sm" onclick={() => copy(form?.minted ?? '')}>
            {copied === form.minted ? 'Copied' : 'Copy'}
          </button>
        </div>
      </Card>
    {/if}

    <Card title="Your invites">
      {#if data.canMint}
        <form method="POST" action="?/mint" use:enhance class="mint">
          <button class="atm-btn atm-btn--primary">Mint an invite</button>
          {#if !data.staff}<span class="atm-hint">{data.open} of {data.cap} open</span>{/if}
        </form>
      {:else if data.cap > 0 && !data.staff && data.open >= data.cap}
        <p class="atm-hint">You have {data.open} open invite{data.open === 1 ? '' : 's'}, which is the limit. Withdraw one to mint another.</p>
      {/if}
      {#if data.invites.length === 0}
        <p class="atm-empty">You haven't minted any invites yet.</p>
      {:else}
        <ul class="invites">
          {#each data.invites as invite (invite.token)}
            <li class="invites__row">
              <div class="invites__meta">
                <span class="invites__state invites__state--{invite.state}">{stateLabel[invite.state]}</span>
                {#if invite.state === 'redeemed'}
                  <span class="atm-hint">used by @{invite.redeemedBy}</span>
                {:else if invite.state === 'open' || invite.state === 'reserved'}
                  <span class="atm-hint">expires {relTime(invite.expiresAt)}</span>
                {:else}
                  <span class="atm-hint">minted {relTime(invite.createdAt)}</span>
                {/if}
              </div>
              {#if invite.state === 'open' || invite.state === 'reserved'}
                <div class="link">
                  <input class="atm-input" readonly value={invite.url} onfocus={(e) => e.currentTarget.select()} />
                  <button type="button" class="atm-btn atm-btn--secondary atm-btn--sm" onclick={() => copy(invite.url)}>
                    {copied === invite.url ? 'Copied' : 'Copy'}
                  </button>
                  <form method="POST" action="?/revoke" use:enhance>
                    <input type="hidden" name="token" value={invite.token} />
                    <button class="atm-btn atm-btn--secondary atm-btn--sm">Withdraw</button>
                  </form>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
  {/if}
</div>

<style>
  @layer atmobb {
  .wrap { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); }
  .title { font: var(--type-page-title); color: var(--forum-ink); margin: 0; }
  .lede { margin: 0; font: var(--type-meta); color: var(--forum-ink-soft); }
  .mint { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
  .link { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
  .link .atm-input { flex: 1; min-width: 12rem; width: auto; font: var(--type-meta); }
  .invites { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .invites__row { display: flex; flex-direction: column; gap: var(--space-2); }
  .invites__meta { display: flex; gap: var(--space-2); align-items: baseline; }
  .invites__state { font: var(--type-meta); text-transform: uppercase; letter-spacing: 0.04em; }
  .invites__state--open { color: var(--forum-accent); }
  .invites__state--redeemed, .invites__state--revoked, .invites__state--expired { color: var(--forum-ink-soft); }
  }
</style>
