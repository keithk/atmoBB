<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy, untrack } from 'svelte';
  import Card from '$lib/components/Card.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import ImageIcon from '$lib/components/ImageIcon.svelte';
  import RichText from '$lib/components/RichText.svelte';
  import { profileHref } from '$lib/profile-card';
  import type { RichTextBlock } from '$lib/richtext/bbcode';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { saved?: boolean; message?: string } | null } = $props();

  // Locally track the signature so the preview updates as you type.
  let signature = $state(untrack(() => data.profile.signature));
  let signatureImages = $state(untrack(() => data.profile.signatureImages));
  let signatureInput: HTMLInputElement;
  let signatureUploading = $state(0);
  let signatureError = $state('');
  let saving = $state(false);
  let avatarName = $state('');
  let avatarInput: HTMLInputElement;

  const signatureBlockCount = $derived((signature.trim() ? 1 : 0) + signatureImages.length);
  const signatureImagePayloads = $derived.by(() =>
    JSON.stringify(
      Object.fromEntries(signatureImages.map((image) => [image.key, { blob: image.blob, ...(image.alt ? { alt: image.alt } : {}) }])),
    ),
  );
  const signatureImageOrder = $derived(JSON.stringify(signatureImages.map((image) => image.key)));
  const signaturePreview: RichTextBlock[] = $derived.by(() => [
    ...(signature.trim()
      ? [{ $type: 'app.atmobb.richtext.block#text', text: signature }]
      : []),
    ...signatureImages.map((image) => ({
      $type: 'app.atmobb.richtext.block#image',
      image: image.blob,
      url: image.url,
      alt: image.alt,
    })),
  ]);
  const previewUrls = new Set<string>();

  onDestroy(() => previewUrls.forEach((url) => URL.revokeObjectURL(url)));

  async function uploadSignatureImage(file: File): Promise<void> {
    signatureUploading++;
    signatureError = '';
    try {
      const body = new FormData();
      body.set('image', file);
      const response = await fetch('/api/upload-image', { method: 'POST', body });
      if (!response.ok) {
        const message = await response.json().then((value) => value?.message).catch(() => null);
        throw new Error(message || 'The image upload failed. Try again.');
      }
      const { blob, cid } = await response.json();
      const url = URL.createObjectURL(file);
      previewUrls.add(url);
      signatureImages.push({ key: crypto.randomUUID(), blob, cid, url, alt: '' });
    } catch (error) {
      signatureError = error instanceof Error ? error.message : 'The image upload failed. Try again.';
    } finally {
      signatureUploading--;
    }
  }

  async function pickSignatureImages(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])].filter((file) => file.type.startsWith('image/'));
    input.value = '';
    for (const file of files) {
      if ((signature.trim() ? 1 : 0) + signatureImages.length >= 3) {
        signatureError = 'Signatures can contain up to three text or image blocks.';
        break;
      }
      await uploadSignatureImage(file);
    }
  }

  function removeSignatureImage(index: number): void {
    const [removed] = signatureImages.splice(index, 1);
    if (removed?.url && previewUrls.delete(removed.url)) URL.revokeObjectURL(removed.url);
    signatureError = '';
  }
</script>

<div class="wrap">
  <nav class="atm-crumbs">
    <a href={profileHref(data.did)}>your profile</a><span class="atm-crumbs__sep">›</span>
    <span class="atm-crumbs__current">edit</span>
  </nav>

  <Card title="Edit profile">
    <form
      method="POST"
      action="?/save"
      enctype="multipart/form-data"
      class="edit"
      use:enhance={() => {
        saving = true;
        return async ({ update, result }) => {
          try {
            await update({ reset: false });
            if (result.type === 'success') {
              avatarName = '';
              avatarInput.value = '';
            }
          } finally {
            saving = false;
          }
        };
      }}
    >
      <p class="lede">
        Your profile is shared across atmobb forums. Changes you make here will
        appear anywhere you use this account.
      </p>

      <div class="avatar-row">
        <Avatar seed={data.did} profile={data.avatarProfile} size={80} alt="Your avatar" />
        <div class="avatar-row__text">
          <span class="atm-label">Avatar</span>
          <label class="atm-btn atm-btn--secondary avatar-upload">
            Upload image
            <input
              bind:this={avatarInput}
              name="avatar"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onchange={(event) => (avatarName = event.currentTarget.files?.[0]?.name ?? '')}
            />
          </label>
          <span class="atm-hint">
            {avatarName || 'PNG, JPEG, WebP, or GIF; up to 1 MB. Choose a file, then save changes.'}
          </span>
          <span class="atm-hint">Use the avatar lab to crop the image, adjust its shape, or add a frame.</span>
        </div>
        <div class="avatar-row__actions">
          <a class="atm-btn atm-btn--secondary" href="/settings/avatar">Open avatar lab</a>
          {#if data.avatarBuilderUrl}
            <a class="atm-btn atm-btn--secondary" href={data.avatarBuilderUrl} rel="external">Build a cartoon avatar</a>
          {/if}
        </div>
      </div>

      <div class="two">
        <label class="atm-field">
          <span class="atm-label">Display name</span>
          <input class="atm-input" name="displayName" value={data.profile.displayName} maxlength="64" placeholder="Your name" />
        </label>
        <div class="atm-field">
          <span class="atm-label">Handle</span>
          <div class="readonly">@{data.handle}</div>
          <span class="atm-hint">Your handle is managed by your account provider, not this forum.</span>
        </div>
      </div>

      <label class="atm-field">
        <span class="atm-label">Bio</span>
        <textarea class="atm-textarea" name="description" rows="3" maxlength="256" placeholder="A line or two about you.">{data.profile.description}</textarea>
      </label>

      <div class="two">
        <label class="atm-field">
          <span class="atm-label">Pronouns</span>
          <input class="atm-input" name="pronouns" value={data.profile.pronouns} maxlength="64" placeholder="they/them" />
        </label>
        <label class="atm-field">
          <span class="atm-label">Website</span>
          <input class="atm-input" name="website" value={data.profile.website} type="url" placeholder="https://…" />
        </label>
      </div>

      <div class="atm-field">
        <span class="atm-label">Signature</span>
        <textarea class="atm-textarea" name="signature" rows="2" bind:value={signature} placeholder="Add a forum signature"></textarea>
        <input type="hidden" name="signature__images" value={signatureImagePayloads} />
        <input type="hidden" name="signature__image_order" value={signatureImageOrder} />
        <div class="signature-upload-row">
          <button
            class="atm-btn atm-btn--secondary"
            type="button"
            disabled={signatureUploading > 0 || signatureBlockCount >= 3}
            onclick={() => signatureInput.click()}
          >
            {#if signatureUploading > 0}
              Uploading…
            {:else}
              <ImageIcon /> Add images
            {/if}
          </button>
          <input
            bind:this={signatureInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onchange={pickSignatureImages}
          />
          <span class="atm-hint">Up to 2 MB each. A signature can have up to three text or image blocks.</span>
        </div>
        {#if signatureImages.length}
          <div class="signature-images">
            {#each signatureImages as image, index (image.key)}
              <div class="signature-image">
                {#if image.url}<img src={image.url} alt={image.alt} />{/if}
                <label class="signature-image__alt">
                  <span class="atm-label">Image description</span>
                  <input class="atm-input" bind:value={image.alt} maxlength="1000" placeholder="Describe this image" />
                </label>
                <button class="atm-btn atm-btn--ghost" type="button" onclick={() => removeSignatureImage(index)}>Remove</button>
              </div>
            {/each}
          </div>
        {/if}
        {#if signatureError}<span class="atm-err" role="alert">{signatureError}</span>{/if}
        {#if signatureBlockCount > 3}
          <span class="atm-err" role="alert">Remove an image or the signature text to stay within three blocks.</span>
        {/if}
        {#if signaturePreview.length}
          <div class="sig-preview">
            <span class="atm-eyebrow">Preview</span>
            <div class="atm-sig sig"><RichText body={signaturePreview} /></div>
          </div>
        {/if}
        <span class="atm-hint">Appears below your posts on atmobb forums.</span>
      </div>

      <div class="actions">
        <span class="status" aria-live="polite">
          {#if form?.message}<span class="atm-err">{form.message}</span>
          {:else if form?.saved}<span class="atm-ok">Profile saved ✓</span>
          {:else}<span class="atm-hint">Profile changes are saved to your account.</span>{/if}
        </span>
        <a class="atm-btn atm-btn--ghost" href={profileHref(data.did)}>Cancel</a>
        <button class="atm-btn atm-btn--primary" disabled={saving || signatureUploading > 0 || signatureBlockCount > 3}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  </Card>
</div>

<style>
  @layer atmobb {
  .wrap { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); }

  .edit { display: flex; flex-direction: column; gap: var(--space-4); }
  .lede { margin: 0; font: var(--type-meta); color: var(--forum-ink-soft); }

  .avatar-row {
    display: flex; align-items: center; gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--forum-surface-2);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
  }
  .avatar-row__text { display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .avatar-row__actions { display: flex; flex-direction: column; gap: var(--space-2); }
  .avatar-upload { align-self: flex-start; cursor: pointer; }
  .avatar-upload input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

  .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
  .atm-textarea { min-height: 60px; }

  .readonly {
    padding: 9px 11px;
    font: var(--type-handle); color: var(--forum-ink-soft);
    background: var(--forum-sunken);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-well);
  }

  .sig-preview {
    padding: 6px 14px 12px;
    background: var(--forum-surface-2);
    border: 1px dashed var(--forum-line-strong);
    border-radius: var(--radius-md);
  }
  .sig-preview .atm-eyebrow { display: block; margin: 6px 0; }
  /* preview sits in its own well, not under a post — no top margin */
  .sig { margin-top: 0; padding-top: 0; border-top: none; }

  .signature-upload-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .signature-images { display: grid; gap: var(--space-2); }
  .signature-image {
    display: grid;
    grid-template-columns: minmax(80px, 140px) 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    background: var(--forum-surface-2);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
  }
  .signature-image img { display: block; max-width: 140px; max-height: 80px; object-fit: contain; }
  .signature-image__alt { display: grid; gap: 3px; }

  .actions {
    display: flex; align-items: center; gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: var(--border-hair) solid var(--forum-line);
  }
  .status { margin-right: auto; }


  @media (max-width: 560px) {
    .two { grid-template-columns: 1fr; }
    .avatar-row { flex-wrap: wrap; }
    .signature-image { grid-template-columns: 80px 1fr; }
    .signature-image .atm-btn { grid-column: 2; justify-self: start; }
    .signature-image img { max-width: 80px; }
  }
  }
</style>
