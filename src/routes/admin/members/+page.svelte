<script lang="ts">
  import { page } from '$app/state';
  import Avatar from '$lib/components/Avatar.svelte';

  let { data, form } = $props();

  const saved = $derived(page.url.searchParams.has('saved'));
  const pending = $derived(page.url.searchParams.has('pending'));
  const gated = $derived(data.mode !== 'open');
  const handle = (did: string) => data.handles[did] ?? did;
  const shortDid = (did: string) => did.slice(8, 20);
  const displayName = (did: string, profile?: { displayName?: string }) =>
    profile?.displayName ?? (handle(did) !== did ? handle(did) : shortDid(did));
  const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '');
  const withParam = (key: string, value: string) => {
    const u = new URL(page.url);
    u.searchParams.set(key, value);
    u.searchParams.delete('saved');
    u.searchParams.delete('pending');
    return `${u.pathname}${u.search}`;
  };
  const stateLabel: Record<string, string> = { pending: 'new', waiting: 'on hold', denied: 'denied' };
</script>

{#if pending}
  <p class="atm-ok">Saved. The change is taking a few extra seconds to show up here — refresh to see it.</p>
{:else if saved}
  <p class="atm-ok">Saved.</p>
{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}
{#if form?.minted}
  <p class="atm-ok minted">
    Invite minted. Copy it now — it won't be shown again:
    <code class="minted__link">{page.url.origin}{form.minted.path}</code>
    <span class="minted__exp">expires {day(form.minted.expiresAt)}</span>
  </p>
{/if}

<div class="cols">
  <section class="main">
    <div class="atm-card">
      <div class="atm-card__header"><span>Join mode</span></div>
      <div class="atm-card__body">
        <form class="atm-editform mode" method="POST" action="?/setMode">
          <div class="mode__options">
            <label class="mode__option">
              <input type="radio" name="mode" value="open" checked={data.mode === 'open'} />
              <span><strong>Open</strong> — anyone with an atproto account can post.</span>
            </label>
            <label class="mode__option">
              <input type="radio" name="mode" value="apply" checked={data.mode === 'apply'} disabled={!data.gatingAvailable} />
              <span><strong>Apply</strong> — people ask to join and staff approve them.</span>
            </label>
            <label class="mode__option">
              <input type="radio" name="mode" value="invite" checked={data.mode === 'invite'} disabled={!data.gatingAvailable} />
              <span><strong>Invite</strong> — members and staff hand out invite links.</span>
            </label>
          </div>
          {#if !data.gatingAvailable}
            <p class="atm-hint">Apply and invite modes need the appview to be updated for membership before they can be turned on.</p>
          {/if}
          <div class="atm-field">
            <span class="atm-label">Application question</span>
            <textarea class="atm-textarea" name="prompt" rows="2" maxlength="3000"
              placeholder="One question applicants answer, e.g. Who sent you?">{data.settings.prompt}</textarea>
          </div>
          <div class="atm-editform__row">
            <div class="atm-field">
              <span class="atm-label">Invites per member</span>
              <input class="atm-input" type="number" name="inviteCap" min="0" max="100" value={data.settings.inviteCap} />
              <span class="atm-hint">Open invites a member may hold at once. 0 means only staff mint.</span>
            </div>
            <div class="atm-field">
              <span class="atm-label">Invite expires after</span>
              <input class="atm-input" type="number" name="inviteDays" min="1" max="365" value={data.settings.inviteDays} />
              <span class="atm-hint">days</span>
            </div>
          </div>
          {#if !gated && data.gatingAvailable}
            <div class="mode__confirm">
              <p class="mode__count">
                {#if data.grandfatherCount === null}
                  Gating the forum accepts everyone who has posted, declared membership, or holds a staff grant as original members; we couldn't count them just now.
                {:else}
                  Gating the forum accepts <strong>{data.grandfatherCount}</strong> {data.grandfatherCount === 1 ? 'person' : 'people'} who
                  {data.grandfatherCount === 1 ? 'has' : 'have'} posted, declared membership, or holds a staff grant as original members. Anyone
                  under a forum-wide ban is left out. Anyone else will need to be accepted before they can post. Everyone can still read.
                {/if}
              </p>
              <label class="mode__really">
                <input type="checkbox" name="really" />
                I understand: from now on only accepted members can post here.
              </label>
            </div>
          {/if}
          {#if data.settings.gatedSince}
            <p class="atm-hint">Gated since {day(data.settings.gatedSince)}. Switching back to open keeps every acceptance.</p>
          {/if}
          <div class="atm-editform__actions">
            <button class="atm-btn atm-btn--primary atm-btn--sm">save join mode</button>
          </div>
        </form>
      </div>
    </div>

    {#if gated}
      <div class="atm-card">
        <div class="atm-card__header"><span>Applications ({data.applications.length})</span></div>
        <div class="atm-card__body rows">
          {#each data.applications as a (a.uri)}
            <div class="reqrow">
              <Avatar seed={a.requester} profile={a.requesterProfile} size={28} />
              <div class="reqrow__who">
                <a class="reqrow__name" href="/members/{encodeURIComponent(handle(a.requester))}">{displayName(a.requester, a.requesterProfile)}</a>
                {#if a.state !== 'pending'}<span class="atm-chip">{stateLabel[a.state] ?? a.state}</span>{/if}
                <span class="reqrow__meta">
                  applied {day(a.createdAt)} ·
                  <a href="https://bsky.app/profile/{handle(a.requester)}" target="_blank" rel="noopener noreferrer">on Bluesky</a>
                </span>
                {#if a.reason}<span class="reqrow__reason">“{a.reason}”</span>{/if}
              </div>
              <div class="reqrow__acts">
                <form method="POST" action="?/approve">
                  <input type="hidden" name="did" value={a.requester} />
                  <button class="atm-btn atm-btn--primary atm-btn--sm">approve</button>
                </form>
                {#if a.state !== 'waiting'}
                  <form method="POST" action="?/hold">
                    <input type="hidden" name="did" value={a.requester} />
                    <button class="atm-btn atm-btn--secondary atm-btn--sm">hold</button>
                  </form>
                {/if}
                {#if a.state !== 'denied'}
                  <form method="POST" action="?/deny">
                    <input type="hidden" name="did" value={a.requester} />
                    <button class="atm-btn atm-btn--ghost atm-btn--sm">deny</button>
                  </form>
                {/if}
              </div>
            </div>
          {:else}
            <p class="atm-empty atm-empty--bare">No applications waiting.</p>
          {/each}
          {#if data.applicationsCursor}
            <a class="more" href={withParam('applications', data.applicationsCursor)}>older applications →</a>
          {/if}
        </div>
      </div>
    {/if}

    <div class="atm-card">
      <div class="atm-card__header"><span>Members</span></div>
      <div class="atm-card__body rows">
        {#each data.roster.members as m (m.did)}
          <div class="member">
            <Avatar seed={m.did} profile={m.profile} size={28} />
            <div class="member__who">
              <a class="member__name" href="/members/{encodeURIComponent(handle(m.did))}">{displayName(m.did, m.profile)}</a>
              <span class="member__meta">
                {#if m.line}{m.line}{/if}
                {#if m.since}{#if m.line} · {/if}since {day(m.since)}{/if}
              </span>
            </div>
            {#if gated}
              <form method="POST" action="?/remove">
                <input type="hidden" name="did" value={m.did} />
                <button class="atm-btn atm-btn--ghost atm-btn--sm">remove</button>
              </form>
            {/if}
          </div>
        {:else}
          <p class="atm-empty atm-empty--bare">No members yet.</p>
        {/each}
        {#if data.roster.cursor}
          <a class="more" href={withParam('members', data.roster.cursor)}>more members →</a>
        {/if}
      </div>
    </div>
  </section>

  <section class="rail">
    {#if gated}
      <div class="atm-card">
        <div class="atm-card__header"><span>Invites</span></div>
        <div class="atm-card__body rows">
          <form method="POST" action="?/mint">
            <button class="atm-btn atm-btn--secondary atm-btn--sm">mint a staff invite</button>
          </form>
          {#each data.invites as i (i.prefix)}
            <div class="invite">
              <code class="invite__token">{i.prefix}…</code>
              <span class="invite__meta">
                by {handle(i.minter) !== i.minter ? `@${handle(i.minter)}` : shortDid(i.minter)}
                · {i.state === 'open' || i.state === 'reserved' ? `expires ${day(i.expiresAt)}` : i.state}
              </span>
              {#if i.state === 'open' || i.state === 'reserved'}
                <form method="POST" action="?/revokeInvite">
                  <input type="hidden" name="prefix" value={i.prefix} />
                  <button class="atm-btn atm-btn--ghost atm-btn--sm">revoke</button>
                </form>
              {/if}
            </div>
          {:else}
            <p class="atm-empty atm-empty--bare">No invites yet.</p>
          {/each}
        </div>
      </div>
    {/if}

    {#if data.requests.length > 0}
      <div class="atm-card">
        <div class="atm-card__header"><span>Board access requests ({data.requests.length})</span></div>
        <div class="atm-card__body rows">
          {#each data.requests as r}
            <div class="reqrow">
              <div class="reqrow__who">
                <strong>{r.requesterProfile?.displayName ?? r.requester.slice(8, 20)}</strong>
                <span class="reqrow__meta">wants access to {r.boardName ?? 'a board'}</span>
                {#if r.reason}<span class="reqrow__reason">“{r.reason}”</span>{/if}
              </div>
              <div class="reqrow__acts">
                <form method="POST" action="?/approveRequest">
                  <input type="hidden" name="board" value={r.board} />
                  <input type="hidden" name="did" value={r.requester} />
                  <button class="atm-btn atm-btn--primary atm-btn--sm">approve</button>
                </form>
                <form method="POST" action="?/denyRequest">
                  <input type="hidden" name="board" value={r.board} />
                  <input type="hidden" name="did" value={r.requester} />
                  <button class="atm-btn atm-btn--ghost atm-btn--sm">deny</button>
                </form>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#each data.privateBoards as board (board.uri)}
      {@const members = data.members[board.uri]}
      <div class="atm-card">
        <div class="atm-card__header"><span>{board.name} · members-only</span></div>
        <div class="atm-card__body">
          {#if !members}
            <p class="members__empty">Couldn't reach the board's space to list members.</p>
          {:else if members.length === 0}
            <p class="members__empty">No members yet. Approve a request above to add one.</p>
          {:else}
            <ul class="members__list">
              {#each members as m}
                <li class="members__row">
                  <a href="/members/{encodeURIComponent(m.handle)}">@{m.handle}</a>
                  <form method="POST" action="?/removeMember">
                    <input type="hidden" name="board" value={board.uri} />
                    <input type="hidden" name="did" value={m.did} />
                    <button class="atm-btn atm-btn--ghost atm-btn--sm">remove</button>
                  </form>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    {/each}
  </section>
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: 1fr 340px;
    gap: var(--space-5);
    align-items: start;
  }
  .main, .rail { display: grid; gap: var(--space-5); min-width: 0; }
  .rows { display: grid; gap: var(--space-2); }
  .more { font: var(--type-meta); justify-self: end; }

  .minted { display: grid; gap: var(--space-1); }
  .minted__link { user-select: all; word-break: break-all; }
  .minted__exp { font: var(--type-meta); color: var(--forum-ink-soft); }

  .mode__options { display: grid; gap: var(--space-2); padding: 0 var(--space-3); }
  .mode__option { display: flex; gap: var(--space-2); align-items: baseline; font: var(--type-ui); }
  .mode__option input:disabled + span { color: var(--forum-ink-faint); }
  /* The gate warning matters only once a gated mode is picked. */
  .mode__confirm { display: none; padding: 0 var(--space-3); }
  .mode:has(input[name="mode"]:not([value="open"]):checked) .mode__confirm { display: grid; gap: var(--space-2); }
  .mode__count { margin: 0; font: var(--type-ui); color: var(--forum-ink-soft); }
  .mode__really { font: var(--type-meta); color: var(--danger-1); display: flex; gap: 6px; align-items: center; }

  .reqrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .reqrow__who { display: flex; flex: 1; gap: var(--space-2); align-items: baseline; flex-wrap: wrap; min-width: 0; }
  .reqrow__name { font: var(--w-semibold) var(--text-sm)/1.3 var(--font-body); color: var(--forum-ink); text-decoration: none; }
  .reqrow__meta { font: var(--type-meta); color: var(--forum-ink-soft); }
  .reqrow__reason { flex-basis: 100%; font: var(--type-meta); color: var(--forum-ink-faint); font-style: italic; }
  .reqrow__acts { display: flex; gap: var(--space-2); }

  .member {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .member:last-of-type { border-bottom: none; }
  .member__who { display: grid; flex: 1; min-width: 0; }
  .member__name { font: var(--w-semibold) var(--text-sm)/1.3 var(--font-body); color: var(--forum-ink); text-decoration: none; }
  .member__meta { font: var(--type-meta); color: var(--forum-ink-soft); }

  .invite { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font: var(--type-meta); }
  .invite__token { font: var(--type-handle); color: var(--forum-ink); }
  .invite__meta { flex: 1; color: var(--forum-ink-soft); }

  .members__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-1); }
  .members__row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font: var(--type-ui); }
  .members__empty { font: var(--type-ui); color: var(--forum-ink-soft); margin: 0; }

  @media (max-width: 860px) {
    .cols { grid-template-columns: 1fr; }
  }
</style>
