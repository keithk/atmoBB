<script lang="ts">
  import { page } from '$app/state';

  let { data, form } = $props();

  const saved = $derived(page.url.searchParams.has('saved'));
  const pending = $derived(page.url.searchParams.has('pending'));
  const topLevel = $derived(data.boards.filter((b) => !b.value.parent));
  const categoryName = (uri?: string) =>
    data.categories.find((c) => c.uri === uri)?.value.name;
</script>

{#if pending}
  <p class="atm-ok">Saved. The change is taking a few extra seconds to show up here — refresh to see it.</p>
{:else if saved}
  <p class="atm-ok">Saved.</p>
{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

{#if data.requests.length > 0}
  <div class="atm-card requests">
    <div class="atm-card__header"><span>Access requests ({data.requests.length})</span></div>
    <div class="atm-card__body rows">
      {#each data.requests as r}
        <div class="reqrow">
          <div class="reqrow__who">
            <strong>{r.requesterProfile?.displayName ?? r.requester.slice(8, 20)}</strong>
            <span class="reqrow__board">wants access to {r.boardName ?? 'a board'}</span>
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

<div class="cols">
  <section>
    <div class="atm-card">
      <div class="atm-card__header"><span>Boards</span></div>
      <div class="atm-card__body rows">
        {#each data.boards as board, i}
          <div class="orow">
            <form class="orow__move" method="POST" action="?/moveBoard">
              <input type="hidden" name="uri" value={board.uri} />
              <button class="orow__btn" name="dir" value="up" disabled={i === 0} aria-label="Move {board.value.name} up">↑</button>
              <button class="orow__btn" name="dir" value="down" disabled={i === data.boards.length - 1} aria-label="Move {board.value.name} down">↓</button>
            </form>
            <details class="atm-adminrow">
              <summary>
                <span class="atm-adminrow__name">
                  {#if board.value.parent}<span class="row__sub">↳</span>{/if}
                  {board.value.name}
                </span>
                <span class="atm-adminrow__meta">
                  {#if board.value.access?.space}<span class="row__private">private</span> · {/if}
                  {#if categoryName(board.value.category)}{categoryName(board.value.category)} · {/if}
                  {board.threadCount} {board.threadCount === 1 ? 'thread' : 'threads'}
                </span>
              </summary>
              <form class="atm-editform" method="POST" action="?/updateBoard">
                <input type="hidden" name="uri" value={board.uri} />
                <div class="atm-field">
                  <span class="atm-label">Name</span>
                  <input class="atm-input" name="name" required maxlength="100" value={board.value.name} />
                </div>
                <div class="atm-field">
                  <span class="atm-label">Description</span>
                  <input class="atm-input" name="description" maxlength="1000" value={board.value.description ?? ''} />
                </div>
                <div class="atm-field">
                  <span class="atm-label">Category</span>
                  <select class="atm-select" name="category">
                    <option value="">(none)</option>
                    {#each data.categories as cat}
                      <option value={cat.uri} selected={board.value.category === cat.uri}>{cat.value.name}</option>
                    {/each}
                  </select>
                </div>
                {#if data.privateBoardsEnabled || board.value.access?.space}
                  <label class="edit__private">
                    <input type="checkbox" name="private" checked={!!board.value.access?.space} />
                    members-only (private board)
                  </label>
                {/if}
                {#if board.value.access?.space}
                  <label class="edit__really">
                    <input type="checkbox" name="really" />
                    I understand that making this board public will delete its private space and every thread inside it.
                  </label>
                {/if}
                <div class="atm-editform__actions">
                  <button class="atm-btn atm-btn--primary atm-btn--sm">save</button>
                </div>
              </form>
              {#if board.value.access?.space}
                {@const members = data.members[board.uri]}
                <div class="members">
                  <span class="atm-label">Members</span>
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
              {/if}
              <form class="edit__danger" method="POST" action="?/deleteBoard">
                <input type="hidden" name="uri" value={board.uri} />
                {#if board.threadCount > 0}
                  <label class="edit__really">
                    <input type="checkbox" name="really" />
                    I understand that {board.threadCount} {board.threadCount === 1 ? 'thread' : 'threads'} will no longer have a board.
                  </label>
                {/if}
                <button class="atm-btn atm-btn--ghost atm-btn--sm">delete board</button>
              </form>
            </details>
          </div>
        {:else}
          <p class="atm-empty atm-empty--bare">No boards yet.</p>
        {/each}
      </div>
    </div>

    <div class="atm-card create">
      <div class="atm-card__header"><span>New board</span></div>
      <div class="atm-card__body">
        <form class="atm-editform" method="POST" action="?/createBoard">
          <div class="atm-field">
            <span class="atm-label">Name</span>
            <input class="atm-input" name="name" required maxlength="100" placeholder="e.g. Heavy rotation" />
          </div>
          <div class="atm-field">
            <span class="atm-label">Description</span>
            <input class="atm-input" name="description" maxlength="1000" placeholder="What belongs here" />
          </div>
          <div class="atm-editform__row">
            <div class="atm-field">
              <span class="atm-label">Category</span>
              <select class="atm-select" name="category">
                <option value="">(none)</option>
                {#each data.categories as cat}
                  <option value={cat.uri}>{cat.value.name}</option>
                {/each}
              </select>
            </div>
            <div class="atm-field">
              <span class="atm-label">Subforum of</span>
              <select class="atm-select" name="parent">
                <option value="">(top level)</option>
                {#each topLevel as b}
                  <option value={b.uri}>{b.value.name}</option>
                {/each}
              </select>
            </div>
          </div>
          {#if data.privateBoardsEnabled}
            <label class="edit__private">
              <input type="checkbox" name="private" />
              members-only (private board)
            </label>
          {/if}
          <div class="atm-editform__actions">
            <button class="atm-btn atm-btn--primary atm-btn--sm">create board</button>
          </div>
        </form>
      </div>
    </div>
  </section>

  <section>
    <div class="atm-card">
      <div class="atm-card__header"><span>Categories</span></div>
      <div class="atm-card__body rows">
        {#each data.categories as cat, i}
          <div class="orow">
            <form class="orow__move" method="POST" action="?/moveCategory">
              <input type="hidden" name="uri" value={cat.uri} />
              <button class="orow__btn" name="dir" value="up" disabled={i === 0} aria-label="Move {cat.value.name} up">↑</button>
              <button class="orow__btn" name="dir" value="down" disabled={i === data.categories.length - 1} aria-label="Move {cat.value.name} down">↓</button>
            </form>
            <details class="atm-adminrow">
              <summary>
                <span class="atm-adminrow__name">{cat.value.name}</span>
              </summary>
              <form class="atm-editform" method="POST" action="?/updateCategory">
                <input type="hidden" name="uri" value={cat.uri} />
                <div class="atm-field">
                  <span class="atm-label">Name</span>
                  <input class="atm-input" name="name" required maxlength="100" value={cat.value.name} />
                </div>
                <div class="atm-editform__actions">
                  <button class="atm-btn atm-btn--primary atm-btn--sm">save</button>
                </div>
              </form>
              <form class="edit__danger" method="POST" action="?/deleteCategory">
                <input type="hidden" name="uri" value={cat.uri} />
                <button class="atm-btn atm-btn--ghost atm-btn--sm">delete category</button>
              </form>
            </details>
          </div>
        {:else}
          <p class="atm-empty atm-empty--bare">No categories yet. Boards will appear under the default heading.</p>
        {/each}
        <form class="newcat" method="POST" action="?/createCategory">
          <input class="atm-input" name="name" required maxlength="100" placeholder="New category name" />
          <button class="atm-btn atm-btn--secondary atm-btn--sm">add</button>
        </form>
      </div>
    </div>
  </section>
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: 1fr 340px;
    gap: var(--space-5);
    align-items: start;
  }
  .rows { display: grid; gap: var(--space-2); }
  .orow { display: flex; gap: var(--space-2); align-items: stretch; }
  .orow > .atm-adminrow { flex: 1; min-width: 0; }
  .orow__move { display: flex; flex-direction: column; justify-content: center; gap: 2px; }
  .orow__btn {
    font: var(--type-meta);
    line-height: 1;
    padding: 3px 6px;
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
    background: var(--forum-surface-2);
    color: var(--forum-ink-soft);
    cursor: pointer;
  }
  .orow__btn:hover:not(:disabled) { color: var(--forum-ink); background: var(--forum-surface-1); }
  .orow__btn:disabled { opacity: 0.35; cursor: default; }
  .row__sub { color: var(--forum-ink-faint); }
  .row__private {
    color: var(--forum-ink-faint);
    text-transform: uppercase;
    font-size: 0.85em;
    letter-spacing: 0.04em;
  }
  .edit__private {
    font: var(--type-meta);
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 0 var(--space-3);
  }
  .edit__danger {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-3) var(--space-3);
  }
  .edit__really { font: var(--type-meta); color: var(--danger-1); display: flex; gap: 6px; align-items: center; }
  .newcat { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
  .newcat .atm-input { flex: 1; }
  .create { margin-top: var(--space-5); }

  .requests { margin-bottom: var(--space-5); }
  .reqrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .reqrow__who { display: flex; gap: var(--space-2); align-items: baseline; flex-wrap: wrap; }
  .reqrow__board { font: var(--type-meta); color: var(--forum-ink-soft); }
  .reqrow__reason { font: var(--type-meta); color: var(--forum-ink-faint); font-style: italic; }
  .reqrow__acts { display: flex; gap: var(--space-2); }

  @media (max-width: 860px) {
    .cols { grid-template-columns: 1fr; }
  }
  .members { display: grid; gap: var(--space-2); margin-top: var(--space-3); }
  .members__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-1); }
  .members__row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font: var(--type-ui); }
  .members__empty { font: var(--type-ui); color: var(--forum-ink-soft); margin: 0; }
</style>
