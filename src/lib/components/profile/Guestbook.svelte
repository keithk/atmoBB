<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Avatar from '$lib/components/Avatar.svelte';
  import { profileHref } from '$lib/profile-card';
  import { GUESTBOOK_MAX_BYTES, GUESTBOOK_MAX_GRAPHEMES, graphemeCount } from '$lib/profile-page';
  import { relTime } from '$lib/reltime';

  interface Entry {
    uri: string;
    cid: string;
    author: string;
    handle: string | null;
    text: string;
    indexedAt: string;
    hidden?: string;
  }

  // The guestbook panel's body: notes newest first, each with the controls
  // this viewer has, then the sign form or why there isn't one. Every control
  // is a plain form posting to the member page's actions.
  let { book, isOwner, ownerName, profilePath, form, pending = false }: {
    book: {
      entries: Entry[];
      cursor: string | null;
      open: boolean;
      sign: 'sign' | 'login' | 'members' | null;
      viewer: string | null;
      staff: boolean;
      reconsented: boolean;
    };
    isOwner: boolean;
    ownerName: string;
    /** The member page's own path, for the login link back. */
    profilePath: string;
    form: { guestbookError?: string; guestbookText?: string; guestbookBlock?: { did: string; handle: string | null } } | null;
    pending?: boolean;
  } = $props();

  // The counter is an enhancement: the server checks the length either way.
  let mounted = $state(false);
  onMount(() => (mounted = true));
  let text = $derived(form?.guestbookText ?? '');
  const used = $derived(graphemeCount(text.trim()));

  const paged = $derived(page.url.searchParams.has('gb'));
  const who = (entry: Entry) => (entry.handle ? `@${entry.handle}` : entry.author);
  const reason = (hidden: string) =>
    hidden === 'staff' ? 'Hidden by staff' : hidden === 'blocked' ? 'Blocked signer' : isOwner ? 'Hidden by you' : 'Hidden by the owner';
</script>

{#if pending}
  <p class="atm-ok">Saved. It's taking a few extra seconds to show up here.</p>
{/if}

{#if form?.guestbookBlock}
  {@const target = form.guestbookBlock}
  <div class="gb-confirm" role="alert">
    <p>Block {target.handle ? `@${target.handle}` : target.did} from your guestbook? Their entries will be hidden.</p>
    <form method="POST" action="?/block" class="gb-confirm__actions">
      <input type="hidden" name="did" value={target.did} />
      <input type="hidden" name="confirm" value="1" />
      <button class="atm-btn atm-btn--danger atm-btn--sm">Yes, block</button>
      <a class="atm-btn atm-btn--ghost atm-btn--sm" href="#panel-guestbook">Cancel</a>
    </form>
  </div>
{/if}

{#if book.entries.length}
  <ol class="gb-entries">
    {#each book.entries as entry (entry.uri)}
      <li class="gb-entry" class:gb-entry--hidden={!!entry.hidden}>
        <Avatar seed={entry.author} size={40} alt="" />
        <div class="gb-entry__main">
          <p class="gb-entry__meta">
            <a href={profileHref(entry.handle ?? entry.author)}>{who(entry)}</a>
            <span aria-hidden="true">·</span>
            <time datetime={entry.indexedAt}>{relTime(entry.indexedAt)}</time>
            {#if entry.hidden}
              <span aria-hidden="true">·</span>
              <span class="gb-entry__reason">{reason(entry.hidden)}</span>
            {/if}
          </p>
          {#if entry.hidden}
            <details class="gb-entry__collapsed">
              <summary>Show the note</summary>
              <p class="gb-entry__text">{entry.text}</p>
            </details>
          {:else}
            <p class="gb-entry__text">{entry.text}</p>
          {/if}

          <div class="gb-entry__actions">
            {#if book.viewer === entry.author}
              <form method="POST" action="?/delete">
                <input type="hidden" name="uri" value={entry.uri} />
                <button class="atm-btn atm-btn--ghost atm-btn--sm">Delete</button>
              </form>
            {/if}
            {#if isOwner && !entry.hidden}
              <form method="POST" action="?/ownerHide">
                <input type="hidden" name="uri" value={entry.uri} />
                <button class="atm-btn atm-btn--ghost atm-btn--sm">Hide</button>
              </form>
              {#if entry.author !== book.viewer}
                <form method="POST" action="?/block">
                  <input type="hidden" name="did" value={entry.author} />
                  <button class="atm-btn atm-btn--ghost atm-btn--sm">Block</button>
                </form>
              {/if}
            {:else if isOwner && entry.hidden === 'owner'}
              <form method="POST" action="?/ownerUnhide">
                <input type="hidden" name="uri" value={entry.uri} />
                <button class="atm-btn atm-btn--ghost atm-btn--sm">Unhide</button>
              </form>
            {:else if isOwner && entry.hidden === 'blocked'}
              <form method="POST" action="?/unblock">
                <input type="hidden" name="did" value={entry.author} />
                <button class="atm-btn atm-btn--ghost atm-btn--sm">Unblock</button>
              </form>
            {/if}
            {#if book.staff && (!entry.hidden || entry.hidden === 'staff')}
              <form method="POST" action={entry.hidden ? '?/staffUnhide' : '?/staffHide'}>
                <input type="hidden" name="uri" value={entry.uri} />
                <input type="hidden" name="cid" value={entry.cid} />
                <button class="atm-btn atm-btn--ghost atm-btn--sm">
                  {isOwner ? (entry.hidden ? 'Staff unhide' : 'Staff hide') : entry.hidden ? 'Unhide' : 'Hide'}
                </button>
              </form>
            {/if}
          </div>
        </div>
      </li>
    {/each}
  </ol>
{:else}
  <p class="atm-empty atm-empty--bare">{isOwner ? 'No notes yet. Members can sign it now.' : 'No notes yet. Be the first.'}</p>
{/if}

{#if book.cursor || paged}
  <nav class="gb-pages" aria-label="Guestbook pages">
    {#if paged}<a href="?#panel-guestbook">Newest notes</a>{/if}
    {#if book.cursor}<a href="?gb={encodeURIComponent(book.cursor)}#panel-guestbook">Older notes</a>{/if}
  </nav>
{/if}

{#if form?.guestbookError}
  <p class="atm-err" role="alert" id="guestbook-error">{form.guestbookError}</p>
{/if}

{#if book.sign === 'sign'}
  <form method="POST" action="?/sign" class="gb-sign">
    {#if book.reconsented}<input type="hidden" name="reconsented" value="1" />{/if}
    <label class="atm-label" for="guestbook-note">Leave a note</label>
    <textarea
      id="guestbook-note"
      class="atm-textarea"
      name="text"
      rows="3"
      required
      maxlength={GUESTBOOK_MAX_BYTES}
      placeholder={`Say hi to ${ownerName}…`}
      aria-describedby={form?.guestbookError ? 'guestbook-error guestbook-count' : 'guestbook-count'}
      bind:value={text}
    ></textarea>
    <div class="gb-sign__foot">
      <span class="atm-hint" id="guestbook-count" aria-live="polite">
        {#if mounted}
          <span class:atm-err={used > GUESTBOOK_MAX_GRAPHEMES}>{used} / {GUESTBOOK_MAX_GRAPHEMES}</span>
        {:else}
          Up to {GUESTBOOK_MAX_GRAPHEMES} characters, plain text.
        {/if}
      </span>
      <button class="atm-btn atm-btn--primary atm-btn--sm">Sign</button>
    </div>
  </form>
{:else if book.sign === 'login'}
  <p class="gb-note"><a href={`/login?next=${encodeURIComponent(profilePath)}`}>Log in to sign</a></p>
{:else if book.sign === 'members'}
  <p class="gb-note">Members can sign this guestbook.</p>
{/if}

{#if isOwner}
  <p class="gb-note"><a href="/settings/page#guestbook">Guestbook settings</a></p>
{/if}

<style>
  @layer atmobb {
    .gb-entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
    .gb-entry {
      display: flex; gap: var(--space-3);
      padding: var(--space-3);
      background: var(--forum-surface-2);
      border: var(--border-hair) solid var(--forum-line);
      border-radius: var(--radius-md);
    }
    .gb-entry--hidden { opacity: 0.7; border-style: dashed; background: transparent; }
    .gb-entry__main { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; flex: 1; }
    .gb-entry__meta { margin: 0; display: flex; flex-wrap: wrap; gap: var(--space-1); font: var(--type-meta); color: var(--forum-ink-soft); }
    .gb-entry__reason { font-weight: var(--w-semibold); }
    .gb-entry__text { margin: 0; font: var(--type-body); color: var(--forum-ink); white-space: pre-wrap; overflow-wrap: anywhere; }
    .gb-entry__collapsed summary { cursor: pointer; font: var(--type-meta); color: var(--forum-link); }
    .gb-entry__actions { display: flex; flex-wrap: wrap; gap: var(--space-1); }
    .gb-entry__actions:empty { display: none; }
    .gb-entry__actions form { margin: 0; }
    .gb-confirm {
      display: flex; flex-direction: column; gap: var(--space-2);
      margin-bottom: var(--space-3); padding: var(--space-3);
      border: var(--border-solid) solid var(--forum-line-strong);
      border-radius: var(--radius-md);
    }
    .gb-confirm p { margin: 0; }
    .gb-confirm__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
    .gb-pages { display: flex; gap: var(--space-3); margin-top: var(--space-3); font: var(--type-meta); }
    .gb-sign { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); }
    .gb-sign__foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
    .gb-note { margin: var(--space-4) 0 0; font: var(--type-meta); color: var(--forum-ink-soft); }
  }
</style>
