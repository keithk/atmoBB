<script lang="ts">
  import { page } from '$app/state';
  import { relTime } from '$lib/reltime';

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
  <div class="atm-card__header"><span>Topics</span></div>
  <div class="atm-card__body">
    <p class="lede">
      Boards that use the same topic share one feed across forums. Threads stay
      on their original forums. The federation setting controls which forums
      can contribute to the feed.
    </p>

    {#if data.directory.length}
      <div class="dir">
        <span class="atm-eyebrow dir__label">topics in use</span>
        <div class="dir__list">
          {#each data.directory as t}
            <a class="dir__topic {data.previewSlug === t.topic ? 'dir__topic--active' : ''}"
              href="?preview={encodeURIComponent(t.topic)}">
              ⁂ {t.topic}
              <span class="dir__nums">{t.forums} {t.forums === 1 ? 'forum' : 'forums'} · {t.threads.toLocaleString()} {t.threads === 1 ? 'thread' : 'threads'}</span>
            </a>
          {/each}
        </div>
      </div>
    {/if}

    <form class="lookup" method="GET">
      <input class="atm-input" name="preview" value={data.previewSlug}
        placeholder="Enter a topic to preview"
        autocapitalize="none" autocorrect="off" spellcheck="false" />
      <button class="atm-btn atm-btn--secondary atm-btn--sm">preview</button>
    </form>

    {#if data.previewSlug}
      {#if data.preview && data.preview.totals && data.preview.totals.boards > 0}
        {@const t = data.preview.totals}
        <div class="preview">
          <p class="preview__sum">
            <span class="atm-eyebrow atm-eyebrow--accent">⁂ {data.preview.topic}</span> includes
            <b>{t.boards}</b> {t.boards === 1 ? 'board' : 'boards'} on
            <b>{t.forums}</b> {t.forums === 1 ? 'forum' : 'forums'} ·
            <b>{t.threads.toLocaleString()}</b> threads ·
            <b>{t.posts.toLocaleString()}</b> posts. Add this topic to a board
            to include these threads there.
          </p>
          {#each data.preview.boards as b}
            <div class="preview__row">
              <span class="atm-via preview__forum">{b.forum.name ?? b.forum.did.slice(8, 24)}</span>
              <span class="preview__board">{b.name}</span>
              {#if b.federation === 'allowlist'}
                <span class="preview__mode">This forum uses an allowlist and may not include your posts.</span>
              {/if}
              <span class="preview__nums">
                {b.threadCount.toLocaleString()} threads · {(b.threadCount + b.replyCount).toLocaleString()} posts
                {#if b.latestActivity}· active {relTime(b.latestActivity)}{/if}
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="preview preview--empty">
          No boards use <b>{data.previewSlug}</b> yet. Add it to one of your
          boards to start the topic.
        </p>
      {/if}
    {/if}
    {#each data.boards as board}
      <details class="atm-adminrow">
        <summary>
          <span class="atm-adminrow__name">
            {#if board.value.topic}<span class="row__mark">⁂</span>{/if}
            {board.value.name}
          </span>
          <span class="atm-adminrow__meta row__meta">
            {#if board.value.topic}
              {board.value.topic} · {board.value.topicFederation ?? 'open'} ·
              {board.threadCount.toLocaleString()} threads network-wide
            {:else}
              not shared
            {/if}
          </span>
        </summary>
        <form class="atm-editform" method="POST" action="?/setTopic">
          <input type="hidden" name="uri" value={board.uri} />
          <div class="atm-editform__row">
            <div class="atm-field">
              <span class="atm-label">Topic</span>
              <input class="atm-input" name="topic" maxlength="64" value={board.value.topic ?? ''}
                placeholder="pop-culture" autocapitalize="none" autocorrect="off" spellcheck="false" />
            </div>
            <div class="atm-field">
              <span class="atm-label">Federation</span>
              <select class="atm-select" name="federation">
                <option value="open" selected={(board.value.topicFederation ?? 'open') === 'open'}>open</option>
                <option value="allowlist" selected={board.value.topicFederation === 'allowlist'}>allowlist</option>
              </select>
            </div>
          </div>
          <div class="atm-field">
            <span class="atm-label">Allowlist (DIDs, for allowlist mode)</span>
            <input class="atm-input" name="allow" value={(board.value.topicAllow ?? []).join(' ')}
              placeholder="did:plc:… did:plc:…" autocapitalize="none" spellcheck="false" />
          </div>
          <div class="atm-editform__actions">
            <button class="atm-btn atm-btn--primary atm-btn--sm">save</button>
            <span class="atm-hint">Clear the topic field to stop sharing this board.</span>
          </div>
        </form>
      </details>
    {/each}
  </div>
</div>

<div class="atm-card panel">
  <div class="atm-card__header"><span>Active moderation</span></div>
  <div class="atm-card__body">
    {#each data.activeActions as a}
      <div class="act">
        <span class="atm-chip atm-chip--danger">{a.value.action}</span>
        <span class="act__what">
          {#if a.value.subject.uri}
            {a.threadTitle ?? a.value.subject.uri}
          {:else}
            {a.subjectForumName ?? a.subjectName ?? a.value.subject.did}
            {#if a.value.board}<span class="act__scope">on one board</span>{/if}
          {/if}
        </span>
        <form method="POST" action="?/undo">
          <input type="hidden" name="action" value={a.value.action} />
          <input type="hidden" name="subjectUri" value={a.value.subject.uri ?? ''} />
          <input type="hidden" name="subjectCid" value={a.value.subject.cid ?? ''} />
          <input type="hidden" name="subjectDid" value={a.value.subject.did ?? ''} />
          <input type="hidden" name="board" value={a.value.board ?? ''} />
          <button class="atm-btn atm-btn--ghost atm-btn--sm">undo</button>
        </form>
      </div>
    {:else}
      <p class="atm-empty atm-empty--bare">No active hides, locks, pins, or blocks.</p>
    {/each}
  </div>
</div>

<style>
  .panel { max-width: 72ch; margin-bottom: var(--space-5); }
  .lede { font: var(--type-meta); color: var(--forum-ink-soft); margin: 0 0 var(--space-3); }
  .lookup { display: flex; gap: var(--space-2); margin-bottom: var(--space-3); }
  .lookup .atm-input { flex: 1; }
  .dir { margin-bottom: var(--space-3); }
  .dir__label { display: block; margin-bottom: var(--space-2); }
  .dir__list { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .dir__topic {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 6px 10px;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-sm);
    background: var(--forum-surface);
    font: var(--w-semibold) var(--text-xs)/1 var(--font-mono);
    color: var(--forum-link);
    text-decoration: none;
  }
  .dir__topic:hover { border-color: var(--forum-link); text-decoration: none; }
  .dir__topic--active { background: var(--forum-accent-soft); border-color: var(--forum-accent); }
  .dir__nums { font: var(--w-regular) var(--text-2xs)/1 var(--font-body); color: var(--forum-ink-soft); }
  .preview {
    background: var(--forum-accent-soft);
    border: var(--border-hair) solid color-mix(in oklch, var(--forum-accent) 45%, var(--forum-line));
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-4);
  }
  .preview--empty { font: var(--type-ui); color: var(--forum-ink-soft); }
  .preview__sum { font: var(--type-ui); color: var(--forum-ink); margin: 0 0 var(--space-2); }
  .preview__row {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    border-top: 1px dashed var(--forum-line-strong);
    font: var(--type-meta);
    color: var(--forum-ink-soft);
    flex-wrap: wrap;
  }
  .preview__forum { color: var(--forum-ink); }
  .preview__board { font-weight: var(--w-semibold); color: var(--forum-ink); }
  .preview__mode { color: var(--warn-1); }
  .preview__nums { margin-left: auto; white-space: nowrap; }
  /* topics rows aren't in a grid; space them, and the meta reads mono */
  .atm-adminrow { margin-bottom: var(--space-2); }
  .row__mark { color: var(--forum-link); }
  .row__meta { font-family: var(--font-mono); }
  .act {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .act__what { flex: 1; min-width: 0; font: var(--type-ui); color: var(--forum-ink); overflow-wrap: anywhere; }
  .act__scope { font: var(--type-meta); color: var(--forum-ink-faint); margin-left: var(--space-2); }
</style>
