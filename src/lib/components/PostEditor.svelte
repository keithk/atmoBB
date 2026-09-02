<script lang="ts">
  import type { JSONContent } from '@tiptap/core';
  import { enhance } from '$app/forms';
  import RichTextEditor from './RichTextEditor.svelte';

  // In-place editor for one of the viewer's own posts. Threads pass a title;
  // replies don't. Posts to the page's `edit` action.
  let {
    uri,
    title,
    doc,
    cancelHref,
    message,
    allowImages = true,
  }: { uri: string; title?: string; doc: JSONContent; cancelHref: string; message?: string; allowImages?: boolean } =
    $props();
  let saving = $state(false);
</script>

<form
  class="atm-postedit"
  method="POST"
  action="?/edit"
  use:enhance={() => {
    saving = true;
    return async ({ update }) => {
      await update({ reset: false });
      saving = false;
    };
  }}
>
  <input type="hidden" name="uri" value={uri} />
  {#if title !== undefined}
    <input class="atm-input" name="title" value={title} required maxlength="300" aria-label="Title" />
  {/if}
  <RichTextEditor name="body" initial={doc} {allowImages} />
  {#if message}<p class="atm-err">{message}</p>{/if}
  <div class="atm-postedit__actions">
    <button class="atm-btn atm-btn--primary atm-btn--sm" disabled={saving}>
      {#if saving}<span class="atm-spinner" aria-hidden="true"></span> Saving…{:else}save changes{/if}
    </button>
    <a class="atm-btn atm-btn--ghost atm-btn--sm" href={cancelHref}>cancel</a>
  </div>
</form>
