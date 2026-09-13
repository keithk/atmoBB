<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Editor, type JSONContent } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { ListItem } from '@tiptap/extension-list';
  import { Placeholder } from '@tiptap/extensions';
  import { Spoiler } from '$lib/richtext/spoiler-mark';
  import { ForumImage } from '$lib/richtext/image-node';
  import { Quote } from '$lib/richtext/quote-node';
  import { MentionDecorations } from '$lib/richtext/mention-decorations';
  import { docToBBCode, collectImages } from '$lib/richtext/tiptap-bbcode';
  import ImageIcon from '$lib/components/ImageIcon.svelte';

  let {
    name,
    value = $bindable(''),
    placeholder = '',
    initial,
    allowImages = true,
  }: {
    name: string;
    value?: string;
    placeholder?: string;
    /** An existing post to reopen, as a Tiptap document (see blocksToDoc). */
    initial?: JSONContent;
    /** Whether image uploads are offered. Off for members-only boards, where
     *  the server refuses them (see assertNoImages). */
    allowImages?: boolean;
  } = $props();

  let element: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let editor = $state<Editor>();
  // The cid → { blob, alt } side-channel, serialized for the hidden input so a
  // plain form POST carries the BlobRefs the [img=cid] tokens in `value` refer to.
  let images = $state('{}');
  let uploading = $state(0);
  let uploadError = $state('');
  // Object URLs for freshly-uploaded images. The PDS's getBlob won't serve a
  // blob until a record references it, so the server's preview URL 404s at
  // compose time; the local file is a reliable preview. Revoked on destroy.
  const previewUrls: string[] = [];
  // Bumped on every transaction so toolbar active-states re-derive from `editor`
  // (the Editor instance itself isn't a Svelte-reactive proxy).
  let tick = $state(0);

  const isActive = (name: string, attrs?: Record<string, unknown>) => {
    tick;
    return editor?.isActive(name, attrs) ?? false;
  };

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          listItem: false,
          horizontalRule: false,
          hardBreak: false,
          blockquote: false,
          link: { openOnClick: false },
        }),
        // The wire format supports single-paragraph, non-nested list items.
        ListItem.extend({ content: 'paragraph' }),
        Quote.extend({ content: 'paragraph+' }),
        Spoiler,
        ForumImage,
        MentionDecorations,
        Placeholder.configure({ placeholder }),
      ],
      content: initial ?? value,
      editorProps: {
        handlePaste: (_view, event) => insertFiles(imageFiles(event.clipboardData?.files)),
        handleDrop: (view, event) => {
          const files = imageFiles((event as DragEvent).dataTransfer?.files);
          if (!files.length) return false;
          const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
          if (at) editor?.commands.focus(at.pos);
          return insertFiles(files);
        },
      },
      onUpdate: ({ editor }) => {
        const doc = editor.getJSON();
        value = docToBBCode(doc);
        images = JSON.stringify(collectImages(doc));
      },
      onTransaction: () => {
        tick++;
      },
    });
    // Reopening a post: fill the hidden inputs before any keystroke, so
    // saving unchanged still submits the full body and its images.
    if (initial) {
      value = docToBBCode(initial);
      images = JSON.stringify(collectImages(initial));
    }
  });

  onDestroy(() => {
    editor?.destroy();
    previewUrls.forEach((u) => URL.revokeObjectURL(u));
  });

  // Pasted and dropped files go through here too, so turning images off
  // silences every way in, not just the toolbar button.
  const imageFiles = (list?: FileList | null): File[] =>
    list && allowImages ? [...list].filter((f) => f.type.startsWith('image/')) : [];

  async function uploadFile(file: File): Promise<void> {
    uploading++;
    uploadError = '';
    try {
      const body = new FormData();
      body.set('image', file);
      const res = await fetch('/api/upload-image', { method: 'POST', body });
      if (!res.ok) {
        const msg = await res.json().then((j) => j?.message).catch(() => null);
        throw new Error(msg || 'The image upload failed. Try again.');
      }
      const { blob, cid } = await res.json();
      const src = URL.createObjectURL(file);
      previewUrls.push(src);
      editor?.chain().focus().insertForumImage({ src, cid, blob, alt: '' }).run();
    } catch (e) {
      uploadError = e instanceof Error ? e.message : 'The image upload failed. Try again.';
    } finally {
      uploading--;
    }
  }

  /** Upload each image file and insert it. Returns true when it consumed the event. */
  function insertFiles(files: File[]): boolean {
    if (!files.length) return false;
    files.forEach(uploadFile);
    return true;
  }

  function pickImages(e: Event) {
    insertFiles(imageFiles((e.target as HTMLInputElement).files));
    (e.target as HTMLInputElement).value = '';
  }

  const setLink = () => {
    if (!editor) return;
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = window.prompt('Link URL', 'https://');
    if (!href) return;
    editor.chain().focus().setLink({ href }).run();
  };
</script>

<div class="atm-editor">
  <!-- Keep mousedown from blurring the editor: a button that steals focus
       drops the caret and eats the next keystrokes. -->
  <div
    class="atm-toolbar"
    role="toolbar"
    aria-label="Formatting"
    onmousedown={(e) => e.preventDefault()}
  >
    {#each [1, 2, 3] as level}
      <button type="button" class="atm-toolbar__btn"
        class:atm-toolbar__btn--active={isActive('heading', { level })}
        aria-pressed={isActive('heading', { level })}
        onclick={() => editor?.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()}
        title="Heading {level}">H{level}</button>
    {/each}
    <button type="button" class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('bulletList')}
      aria-pressed={isActive('bulletList')}
      onclick={() => editor?.chain().focus().toggleBulletList().run()}
      title="Bulleted list">• list</button>
    <button type="button" class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('orderedList')}
      aria-pressed={isActive('orderedList')}
      onclick={() => editor?.chain().focus().toggleOrderedList().run()}
      title="Numbered list">1. list</button>
    <span class="atm-toolbar__sep"></span>
    <button
      type="button"
      class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('bold')}
      onclick={() => editor?.chain().focus().toggleBold().run()}
      title="Bold"><b>B</b></button
    >
    <button
      type="button"
      class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('italic')}
      onclick={() => editor?.chain().focus().toggleItalic().run()}
      title="Italic"><i>I</i></button
    >
    <button
      type="button"
      class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('underline')}
      onclick={() => editor?.chain().focus().toggleUnderline().run()}
      title="Underline"><u>U</u></button
    >
    <button
      type="button"
      class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('strike')}
      onclick={() => editor?.chain().focus().toggleStrike().run()}
      title="Strikethrough"><s>S</s></button
    >
    <span class="atm-toolbar__sep"></span>
    <button
      type="button"
      class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('spoiler')}
      onclick={() => editor?.chain().focus().toggleSpoiler().run()}
      title="Spoiler">spoiler</button
    >
    <button
      type="button"
      class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('link')}
      onclick={setLink}
      title="Link">link</button
    >
    <span class="atm-toolbar__sep"></span>
    <button
      type="button"
      class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('blockquote')}
      onclick={() => editor?.chain().focus().toggleBlockquote().run()}
      title="Quote">❝ quote</button
    >
    <button
      type="button"
      class="atm-toolbar__btn"
      class:atm-toolbar__btn--active={isActive('codeBlock')}
      onclick={() => editor?.chain().focus().toggleCodeBlock().run()}
      title="Code">code</button
    >
    {#if allowImages}
      <span class="atm-toolbar__sep"></span>
      <button
        type="button"
        class="atm-toolbar__btn"
        onclick={() => fileInput.click()}
        title="Insert image"><ImageIcon /> image</button
      >
      {#if uploading > 0}<span class="atm-toolbar__note">uploading…</span>{/if}
    {/if}
  </div>
  <div class="atm-textarea atm-prose" bind:this={element}></div>
  {#if uploadError}<p class="atm-editor__error" role="alert">{uploadError}</p>{/if}
  {#if allowImages}
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      multiple
      hidden
      onchange={pickImages}
    />
  {/if}
  <input type="hidden" {name} {value} />
  <input type="hidden" name="{name}__images" value={images} />
</div>

<style>
  @layer atmobb {
  .atm-editor { display: contents; }

  /* The wrapper is the visible control; the contenteditable fills it so the
     whole well is clickable and shows a single focus ring (the tiptap element
     carries tabindex, which would otherwise pick up base.css's own ring). */
  .atm-prose {
    padding: 0;
    cursor: text;
  }
  .atm-prose:focus-within {
    outline: none;
    border-color: var(--forum-accent);
    box-shadow: var(--shadow-well), var(--focus-ring);
  }
  .atm-prose :global(.tiptap) {
    outline: none;
    box-shadow: none;
    min-height: 120px;
    padding: 9px 11px;
  }
  .atm-prose :global(p) { margin: 0 0 var(--space-3); }
  .atm-prose :global(p:last-child) { margin-bottom: 0; }
  .atm-prose :global(p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--forum-ink-faint);
    pointer-events: none;
  }
  .atm-prose :global(strong) { font-weight: var(--w-bold); }
  .atm-prose :global(em) { font-style: italic; }
  .atm-prose :global(s) { text-decoration: line-through; }
  .atm-prose :global(a) { color: var(--forum-link); }
  .atm-prose :global(.atm-editor-mention) {
    color: var(--forum-link);
    font-weight: var(--w-semibold);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
  .atm-prose :global(.atm-editor-mention__avatar) {
    display: inline-flex;
    width: 1.15em;
    height: 1.15em;
    margin-right: 0.2em;
    align-items: center;
    justify-content: center;
    vertical-align: -0.18em;
    overflow: hidden;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: 50%;
    background: var(--forum-surface-2);
    color: var(--forum-ink-soft);
    font: var(--w-bold) 0.65em/1 var(--font-ui);
  }
  .atm-prose :global(.atm-editor-mention__avatar img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .atm-prose :global(span[data-spoiler]) {
    background: var(--forum-surface-2);
    border: 1px dashed var(--forum-line-strong);
    border-radius: var(--radius-xs);
    padding: 0 2px;
  }
  .atm-prose :global(img[data-cid]) {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-xs);
    margin: var(--space-2) 0;
  }
  .atm-prose :global(img[data-cid].ProseMirror-selectednode) {
    outline: 2px solid var(--forum-accent);
    outline-offset: 2px;
  }
  .atm-toolbar__note { font: var(--type-meta); color: var(--forum-ink-faint); align-self: center; }
  .atm-editor__error { margin: var(--space-2) 0 0; font: var(--type-meta); color: var(--danger-1); }
  /* blockquote/pre chrome comes from .atm-prose in content.css */
  .atm-prose :global(blockquote p) { margin-bottom: var(--space-2); }
  .atm-prose :global(blockquote p:last-child) { margin-bottom: 0; }
  .atm-prose :global(pre code) { background: none; padding: 0; }

  .atm-toolbar__btn--active { background: var(--forum-surface); color: var(--forum-ink); border-color: var(--forum-accent); }
  }
</style>
