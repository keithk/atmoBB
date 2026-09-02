<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy } from 'svelte';
  import Card from '$lib/components/Card.svelte';
  import type { PageData } from './$types';

  interface BorderOption {
    name: string;
    width: number;
  }

  let {
    data,
    form,
  }: {
    data: PageData;
    form: { saved?: boolean; message?: string } | null;
  } = $props();

  const borderOptions: BorderOption[] = [
    { name: 'None', width: 0 },
    { name: 'Thin', width: 1 },
    { name: 'Medium', width: 3 },
    { name: 'Thick', width: 6 },
  ];

  let canvas: HTMLCanvasElement;
  let renderedInput: HTMLInputElement;
  let saveForm: HTMLFormElement;
  let sourceImage = $state<HTMLImageElement | null>(null);
  let sourceName = $state('');
  let sourceObjectUrl: string | null = null;
  let borderColor = $state('#2b2a2e');
  let borderWidth = $state(1);
  let zoom = $state(1);
  let positionX = $state(0);
  let positionY = $state(0);
  let dragging = $state(false);
  let dragPointer: number | null = null;
  let dragX = 0;
  let dragY = 0;
  let saving = $state(false);
  let localMessage = $state('');

  const ready = $derived(sourceImage !== null);

  onDestroy(() => {
    if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  });

  $effect(() => {
    void [canvas, sourceImage, borderColor, borderWidth, zoom, positionX, positionY];
    drawAvatar();
  });

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function paintPhoto(context: CanvasRenderingContext2D, size: number): void {
    if (!sourceImage) return;
    const baseScale = Math.max(size / sourceImage.naturalWidth, size / sourceImage.naturalHeight);
    const scale = baseScale * zoom;
    const width = sourceImage.naturalWidth * scale;
    const height = sourceImage.naturalHeight * scale;
    const horizontalRoom = Math.max(0, (width - size) / 2);
    const verticalRoom = Math.max(0, (height - size) / 2);
    const x = (size - width) / 2 + (positionX / 100) * horizontalRoom;
    const y = (size - height) / 2 + (positionY / 100) * verticalRoom;
    context.drawImage(sourceImage, x, y, width, height);
  }

  function drawPlaceholder(context: CanvasRenderingContext2D, size: number): void {
    context.fillStyle = '#e5e2de';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#aaa6a1';
    context.beginPath();
    context.arc(size / 2, size * 0.37, size * 0.17, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(size / 2, size * 0.88, size * 0.31, Math.PI, Math.PI * 2);
    context.fill();
  }

  function drawAvatar(): void {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const imageSize = 100 - borderWidth * 2;

    context.clearRect(0, 0, 100, 100);
    context.fillStyle = borderColor;
    context.fillRect(0, 0, 100, 100);
    context.save();
    context.translate(borderWidth, borderWidth);
    context.beginPath();
    context.rect(0, 0, imageSize, imageSize);
    context.clip();
    if (sourceImage) paintPhoto(context, imageSize);
    else drawPlaceholder(context, imageSize);
    context.restore();
  }

  function imageFromUrl(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That image could not be opened.'));
      image.src = url;
    });
  }

  async function useFile(file: File | undefined): Promise<void> {
    if (!file) return;
    localMessage = '';
    const supported = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    if (!supported.has(file.type)) {
      localMessage = 'Choose a PNG, JPEG, WebP, or GIF image.';
      return;
    }
    if (file.size > 12_000_000) {
      localMessage = 'Choose an image smaller than 12 MB.';
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await imageFromUrl(objectUrl);
      if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
      sourceObjectUrl = objectUrl;
      sourceImage = image;
      sourceName = file.name;
      resetCrop();
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      localMessage = error instanceof Error ? error.message : 'That image could not be opened.';
    }
  }

  async function useCurrentAvatar(): Promise<void> {
    if (!data.currentAvatar) return;
    localMessage = '';
    try {
      const image = await imageFromUrl(data.currentAvatar);
      if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
      sourceObjectUrl = null;
      sourceImage = image;
      sourceName = 'Current avatar';
      resetCrop();
    } catch (error) {
      localMessage = error instanceof Error ? error.message : 'Your current avatar could not be opened.';
    }
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    void useFile(event.dataTransfer?.files[0]);
  }

  function resetCrop(): void {
    zoom = 1;
    positionX = 0;
    positionY = 0;
  }

  function startDrag(event: PointerEvent): void {
    if (!sourceImage) return;
    dragPointer = event.pointerId;
    dragX = event.clientX;
    dragY = event.clientY;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent): void {
    if (dragPointer !== event.pointerId) return;
    const bounds = canvas.getBoundingClientRect();
    const deltaX = event.clientX - dragX;
    const deltaY = event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    positionX = clamp(positionX + (deltaX / bounds.width) * 200, -100, 100);
    positionY = clamp(positionY + (deltaY / bounds.height) * 200, -100, 100);
  }

  function endDrag(event: PointerEvent): void {
    if (dragPointer !== event.pointerId) return;
    dragPointer = null;
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function moveWithKeyboard(event: KeyboardEvent): void {
    if (!sourceImage) return;
    const step = event.shiftKey ? 10 : 3;
    if (event.key === 'ArrowLeft') positionX = clamp(positionX - step, -100, 100);
    else if (event.key === 'ArrowRight') positionX = clamp(positionX + step, -100, 100);
    else if (event.key === 'ArrowUp') positionY = clamp(positionY - step, -100, 100);
    else if (event.key === 'ArrowDown') positionY = clamp(positionY + step, -100, 100);
    else return;
    event.preventDefault();
  }

  function avatarBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not render the avatar.')), 'image/png');
    });
  }

  async function saveAvatar(): Promise<void> {
    if (!sourceImage || saving) return;
    saving = true;
    localMessage = '';
    try {
      const blob = await avatarBlob();
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'atmobb-avatar-100x100.png', { type: 'image/png' }));
      renderedInput.files = transfer.files;
      saveForm.requestSubmit();
    } catch (error) {
      saving = false;
      localMessage = error instanceof Error ? error.message : 'Could not render the avatar.';
    }
  }

  async function downloadAvatar(): Promise<void> {
    if (!sourceImage) return;
    localMessage = '';
    try {
      const blob = await avatarBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'atmobb-avatar-100x100.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      localMessage = error instanceof Error ? error.message : 'Could not download the avatar.';
    }
  }
</script>

<div class="wrap">
  <nav class="atm-crumbs">
    <a href="/settings/profile">edit profile</a><span class="atm-crumbs__sep">›</span>
    <span class="atm-crumbs__current">create a userpic</span>
  </nav>

  <Card title="Create a 100 × 100 userpic">
    <p class="lede">Choose a picture, crop it to a square, and add a border if you like.</p>

    <div class="builder">
      <section class="preview" aria-labelledby="preview-title">
        <div class="preview__heading">
          <b id="preview-title">Preview</b>
          <span>100 × 100 px</span>
        </div>
        <div class="preview__well">
          <canvas
            bind:this={canvas}
            width="100"
            height="100"
            class:dragging
            class:ready
            tabindex={ready ? 0 : -1}
            aria-label="Avatar preview"
            aria-describedby="preview-help"
            onpointerdown={startDrag}
            onpointermove={moveDrag}
            onpointerup={endDrag}
            onpointercancel={endDrag}
            onkeydown={moveWithKeyboard}
          ></canvas>
        </div>
        <p id="preview-help" class="preview__help">
          {ready ? 'Drag to reposition. Arrow keys work too.' : 'Your picture will appear here.'}
        </p>
      </section>

      <div class="controls">
        <section class="control-group" aria-labelledby="choose-title">
          <h2 id="choose-title"><span>1</span> Choose a picture</h2>
          <div class="image-picker">
            <label
              class="atm-btn atm-btn--secondary file-picker"
              for="source-image"
              ondragover={(event) => event.preventDefault()}
              ondrop={handleDrop}
            >
              Choose image…
              <input
                id="source-image"
                class="source-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onchange={(event) => void useFile(event.currentTarget.files?.[0])}
              />
            </label>
            <span class="source-name">{sourceName || 'No image selected'}</span>
          </div>
          <p class="atm-hint">PNG, JPEG, WebP, or GIF; up to 12 MB. You can also drop a file on the button.</p>
          {#if data.currentAvatar}
            <button class="atm-linkbtn use-current" type="button" onclick={useCurrentAvatar}>Use my current avatar</button>
          {/if}
        </section>

        <section class="control-group" aria-labelledby="crop-title">
          <h2 id="crop-title"><span>2</span> Crop</h2>
          <label class="range-control">
            <span>Zoom <output>{Math.round(zoom * 100)}%</output></span>
            <input type="range" min="1" max="3" step="0.01" bind:value={zoom} disabled={!ready} />
          </label>
          <button class="atm-linkbtn reset-crop" type="button" onclick={resetCrop} disabled={!ready}>Reset crop</button>
        </section>

        <section class="control-group" aria-labelledby="border-title">
          <h2 id="border-title"><span>3</span> Border</h2>
          <div class="border-options">
            {#each borderOptions as option}
              <button
                type="button"
                class:active={option.width === borderWidth}
                aria-pressed={option.width === borderWidth}
                onclick={() => (borderWidth = option.width)}
              >
                <span
                  class="border-sample"
                  style="--sample-width: {option.width}px; --sample-color: {borderColor}"
                  aria-hidden="true"
                ></span>
                {option.name}
              </button>
            {/each}
          </div>
          <label class="color-control">
            <span>Border color</span>
            <input type="color" bind:value={borderColor} disabled={borderWidth === 0} />
            <code>{borderColor.toUpperCase()}</code>
          </label>
        </section>
      </div>
    </div>

    <form
      bind:this={saveForm}
      method="POST"
      action="?/save"
      enctype="multipart/form-data"
      class="actions"
      use:enhance={() => {
        return async ({ update }) => {
          try {
            await update({ reset: false });
          } finally {
            saving = false;
          }
        };
      }}
    >
      <input bind:this={renderedInput} class="rendered-input" name="avatar" type="file" accept="image/png" aria-label="Rendered avatar file" />
      <span class="status" aria-live="polite">
        {#if localMessage}<span class="atm-err">{localMessage}</span>
        {:else if form?.message}<span class="atm-err">{form.message}</span>
        {:else if form?.saved}<span class="atm-ok">Saved to your profile ✓</span>
        {:else}<span class="atm-hint">Saved as a 100 × 100 PNG.</span>{/if}
      </span>
      <button class="atm-btn atm-btn--secondary" type="button" disabled={!ready} onclick={downloadAvatar}>Download PNG</button>
      <button class="atm-btn atm-btn--primary" type="button" disabled={!ready || saving} onclick={saveAvatar}>
        {saving ? 'Saving…' : 'Use as my avatar'}
      </button>
    </form>
  </Card>
</div>

<style>
  @layer atmobb {
  .wrap {
    max-width: 760px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .lede {
    margin: 0 0 var(--space-5);
    color: var(--forum-ink-soft);
    font: var(--type-ui);
  }

  .builder {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    align-items: start;
    gap: var(--space-6);
  }

  .preview {
    overflow: hidden;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-md);
    background: var(--forum-surface);
  }
  .preview__heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 8px 10px;
    border-bottom: var(--border-hair) solid var(--forum-line);
    background: var(--forum-surface-2);
    color: var(--forum-ink-soft);
    font: var(--type-meta);
  }
  .preview__heading b { color: var(--forum-ink); }
  .preview__well {
    display: grid;
    min-height: 238px;
    padding: var(--space-5);
    place-items: center;
    background: var(--forum-sunken);
    box-shadow: var(--shadow-well);
  }
  canvas {
    display: block;
    width: 200px;
    max-width: 100%;
    aspect-ratio: 1;
    border: var(--border-hair) solid var(--forum-line-strong);
    background: var(--forum-surface-2);
    touch-action: none;
  }
  canvas.ready { cursor: grab; }
  canvas.dragging { cursor: grabbing; }
  .preview__help {
    min-height: 48px;
    margin: 0;
    padding: 9px 10px;
    border-top: var(--border-hair) solid var(--forum-line);
    color: var(--forum-ink-faint);
    font: var(--type-meta);
  }

  .controls { min-width: 0; }
  .control-group { padding: 0 0 var(--space-4); }
  .control-group + .control-group {
    padding-top: var(--space-4);
    border-top: var(--border-hair) solid var(--forum-line);
  }
  .control-group:last-child { padding-bottom: 0; }
  .control-group h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    font: var(--type-board-title);
  }
  .control-group h2 span {
    display: inline-grid;
    width: 22px;
    height: 22px;
    flex: none;
    place-items: center;
    border: var(--border-hair) solid var(--forum-line-strong);
    background: var(--forum-surface-2);
    color: var(--forum-ink-soft);
    font: var(--w-bold) var(--text-2xs)/1 var(--font-mono);
  }

  .image-picker {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-3);
  }
  .file-picker { flex: none; cursor: pointer; }
  .source-input, .rendered-input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .source-name {
    min-width: 0;
    overflow: hidden;
    color: var(--forum-ink-soft);
    font: var(--type-meta);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .control-group .atm-hint { display: block; margin-top: var(--space-2); }
  .use-current { display: block; margin-top: var(--space-2); }

  .range-control { display: flex; flex-direction: column; gap: 6px; }
  .range-control > span {
    display: flex;
    justify-content: space-between;
    color: var(--forum-ink-soft);
    font: var(--type-ui);
  }
  output { color: var(--forum-ink); font: var(--type-handle); }
  input[type="range"] { width: 100%; accent-color: var(--forum-accent); cursor: ew-resize; }
  input[type="range"]:disabled { cursor: not-allowed; }
  .reset-crop { margin-top: var(--space-2); }
  .reset-crop:disabled { opacity: .5; cursor: not-allowed; }

  .border-options {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
  }
  .border-options button {
    display: flex;
    min-width: 0;
    padding: 8px 5px;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-sm);
    background: var(--forum-surface);
    color: var(--forum-ink-soft);
    font: var(--type-meta);
    cursor: pointer;
  }
  .border-options button:hover { background: var(--forum-surface-2); }
  .border-options button.active {
    border-color: var(--forum-accent);
    background: var(--forum-accent-soft);
    color: var(--forum-ink);
  }
  .border-sample {
    width: 28px;
    height: 28px;
    border: var(--sample-width) solid var(--sample-color);
    background: var(--forum-sunken);
    box-shadow: inset 0 0 0 1px var(--forum-line);
  }
  .color-control {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
    color: var(--forum-ink-soft);
    font: var(--type-ui);
  }
  .color-control input {
    width: 34px;
    height: 30px;
    margin-left: auto;
    padding: 2px;
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-sm);
    background: var(--forum-surface);
    cursor: pointer;
  }
  .color-control input:disabled { cursor: not-allowed; opacity: .5; }
  .color-control code { min-width: 62px; color: var(--forum-ink-soft); font-size: var(--text-2xs); }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: var(--border-hair) solid var(--forum-line);
  }
  .status { min-width: 0; margin-right: auto; }

  @media (max-width: 640px) {
    .builder { grid-template-columns: 1fr; gap: var(--space-5); }
    .preview { width: min(100%, 280px); justify-self: center; }
    .actions { flex-wrap: wrap; }
    .status { width: 100%; margin-right: 0; }
  }

  @media (max-width: 420px) {
    .border-options { grid-template-columns: repeat(2, 1fr); }
    .actions { align-items: stretch; flex-direction: column; }
    .actions .atm-btn { width: 100%; }
  }
  }
</style>
