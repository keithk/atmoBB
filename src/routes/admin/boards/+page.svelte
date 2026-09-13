<script lang="ts">
  import { page } from '$app/state';
  import BoardColorInput from '$lib/components/BoardColorInput.svelte';
  import BoardMarker from '$lib/components/BoardMarker.svelte';
  import { boardOrderPeers, groupBoards } from '$lib/board-presentation';

  let { data, form } = $props();

  const saved = $derived(page.url.searchParams.has('saved'));
  const pending = $derived(page.url.searchParams.has('pending'));
  const topLevel = $derived(data.boards.filter((b) => !b.value.parent));
  const boardGroups = $derived(
    groupBoards(data.boards, data.categories).map((group) => ({
      ...group,
      boards: group.boards.flatMap((board) => [board, ...board.children]),
    })),
  );
  const orderPosition = (uri: string) => {
    const peers = boardOrderPeers(data.boards, data.categories, uri) ?? [];
    return { index: peers.findIndex((board) => board.uri === uri), length: peers.length };
  };
  const categoryName = (uri?: string) =>
    data.categories.find((c) => c.uri === uri)?.value.name;
</script>

{#if pending}
  <p class="atm-ok">Saved. The change is taking a few extra seconds to show up here — refresh to see it.</p>
{:else if saved}
  <p class="atm-ok">Saved.</p>
{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

<p class="atm-hint members-note">Access requests and each members-only board's readers are on <a href="/admin/members">Members</a>.</p>

<div class="cols">
  <section>
    <div class="atm-card">
      <div class="atm-card__header"><span>Boards</span></div>
      <div class="atm-card__body board-groups">
        {#each boardGroups as group, groupIndex}
          <section class="board-group" aria-labelledby="board-group-{groupIndex}">
            <h3 id="board-group-{groupIndex}" class="board-group__heading">{group.name}</h3>
            <div class="rows">
              {#each group.boards as board, i}
                {@const position = orderPosition(board.uri)}
                <div class:orow--sub={!!board.value.parent} class="orow">
                  <form class="orow__move" method="POST" action="?/moveBoard">
                    <input type="hidden" name="uri" value={board.uri} />
                    <button class="orow__btn" name="dir" value="up" disabled={position.index === 0} aria-label="Move {board.value.name} up">↑</button>
                    <button class="orow__btn" name="dir" value="down" disabled={position.index === position.length - 1} aria-label="Move {board.value.name} down">↓</button>
                  </form>
                  <details class="atm-adminrow">
                    <summary>
                      <span class="atm-adminrow__name">
                        {#if board.value.parent}<span class="row__sub">↳</span>{/if}
                        <BoardMarker color={board.value.color} />
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
                        <label class="atm-label" for="board-color-{groupIndex}-{i}">Color</label>
                        <BoardColorInput
                          id="board-color-{groupIndex}-{i}"
                          value={board.value.color}
                          describedBy="board-color-help-{groupIndex}-{i}"
                        />
                        <span class="field-help" id="board-color-help-{groupIndex}-{i}">Full six-digit hex color used for this board's marker.</span>
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
              {/each}
            </div>
          </section>
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
          <div class="atm-field">
            <label class="atm-label" for="new-board-color">Color</label>
            <BoardColorInput id="new-board-color" describedBy="new-board-color-help" />
            <span class="field-help" id="new-board-color-help">Full six-digit hex color used for this board's marker.</span>
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
  .rows, .board-groups { display: grid; gap: var(--space-2); }
  .board-group { display: grid; gap: var(--space-2); }
  .board-group + .board-group { margin-top: var(--space-3); }
  .board-group__heading {
    margin: 0;
    padding-bottom: var(--space-1);
    border-bottom: var(--border-hair) solid var(--forum-line);
    font: var(--type-meta);
    color: var(--forum-ink-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .orow { display: flex; gap: var(--space-2); align-items: stretch; }
  .orow--sub { margin-left: var(--space-4); }
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
  .atm-adminrow__name { display: inline-flex; align-items: center; gap: var(--space-2); }
  .field-help { font: var(--type-meta); color: var(--forum-ink-faint); }
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

  .members-note { margin-bottom: var(--space-4); }

  @media (max-width: 860px) {
    .cols { grid-template-columns: 1fr; }
  }
</style>
