<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy } from 'svelte';
  import '@fontsource/silkscreen/400.css';
  import '@fontsource/silkscreen/700.css';
  import type { PageData } from './$types';

  type FrameId = 'ink' | 'bubblegum' | 'chrome' | 'checker';
  type EffectId = 'clean' | 'flash' | 'faded' | 'mono' | 'pixel';

  interface FramePreset {
    id: FrameId;
    name: string;
    note: string;
    frame: string;
    background: string;
  }

  interface EffectPreset {
    id: EffectId;
    name: string;
  }

  let {
    data,
    form,
  }: {
    data: PageData;
    form: { saved?: boolean; message?: string } | null;
  } = $props();

  const frames: FramePreset[] = [
    { id: 'ink', name: 'Black', note: 'extra heavy', frame: '#191622', background: '#ffe74f' },
    { id: 'bubblegum', name: 'Pink', note: 'bubblegum', frame: '#ff4fa3', background: '#8ee8ff' },
    { id: 'chrome', name: 'Cyber', note: 'solid blue', frame: '#315dff', background: '#b7ff46' },
    { id: 'checker', name: 'Check', note: 'black + white', frame: '#181818', background: '#ff83c1' },
  ];
  const effects: EffectPreset[] = [
    { id: 'clean', name: 'Clean' },
    { id: 'flash', name: 'Flash!' },
    { id: 'faded', name: 'Faded' },
    { id: 'mono', name: 'B&W' },
    { id: 'pixel', name: 'Pixel' },
  ];

  let canvas: HTMLCanvasElement;
  let renderedInput: HTMLInputElement;
  let saveForm: HTMLFormElement;
  let sourceImage = $state<HTMLImageElement | null>(null);
  let sourceName = $state('');
  let sourceObjectUrl: string | null = null;
  let frameId = $state<FrameId>('ink');
  let effectId = $state<EffectId>('flash');
  let borderColor = $state('#191622');
  let backgroundColor = $state('#ffe74f');
  let borderWidth = $state(10);
  let zoom = $state(1);
  let positionX = $state(0);
  let positionY = $state(0);
  let rotation = $state(0);
  let skew = $state(-6);
  let stamp = $state('');
  let sparkles = $state(false);
  let dragging = $state(false);
  let dragPointer: number | null = null;
  let dragX = 0;
  let dragY = 0;
  let saving = $state(false);
  let localMessage = $state('');

  const selectedFrame = $derived(frames.find((frame) => frame.id === frameId) ?? frames[0]);
  const ready = $derived(sourceImage !== null);

  onDestroy(() => {
    if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  });

  $effect(() => {
    void [canvas, sourceImage, selectedFrame, effectId, borderColor, backgroundColor, borderWidth,
      zoom, positionX, positionY, rotation, skew, stamp, sparkles];
    drawAvatar();
  });

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function selectFrame(frame: FramePreset): void {
    frameId = frame.id;
    borderColor = frame.frame;
    backgroundColor = frame.background;
  }

  function filterFor(effect: EffectId): string {
    if (effect === 'flash') return 'contrast(1.18) saturate(1.45) brightness(1.08)';
    if (effect === 'faded') return 'sepia(0.32) saturate(0.76) contrast(0.9) brightness(1.08)';
    if (effect === 'mono') return 'grayscale(1) contrast(1.2)';
    return 'none';
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
    context.filter = filterFor(effectId);
    context.drawImage(sourceImage, x, y, width, height);
    context.filter = 'none';
  }

  function drawPlaceholder(context: CanvasRenderingContext2D, size: number): void {
    const left = -size / 2;
    const top = -size / 2;
    context.fillStyle = '#8ee8ff';
    context.fillRect(left, top, size, size);

    context.fillStyle = 'rgba(36, 27, 51, 0.2)';
    context.beginPath();
    context.arc(0, -size * 0.11, size * 0.2, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(0, size * 0.39, size * 0.35, Math.PI, Math.PI * 2);
    context.fill();

    context.fillStyle = '#292032';
    context.font = `700 ${Math.max(6, size * 0.11)}px Silkscreen, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('IMAGE', 0, size * 0.34);
  }

  function drawStar(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
    context.save();
    context.translate(x, y);
    context.beginPath();
    for (let point = 0; point < 8; point += 1) {
      const angle = (Math.PI * point) / 4;
      const length = point % 2 === 0 ? radius : radius * 0.2;
      context.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
    }
    context.closePath();
    context.fillStyle = color;
    context.fill();
    context.restore();
  }

  function drawAvatar(): void {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const outerSize = 78;
    const innerSize = outerSize - borderWidth * 2;

    context.clearRect(0, 0, 100, 100);
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, 100, 100);

    context.save();
    context.translate(50, 48);
    context.rotate((rotation * Math.PI) / 180);
    context.transform(1, 0, Math.tan((skew * Math.PI) / 180), 1, 0, 0);
    context.fillStyle = borderColor;
    context.fillRect(-outerSize / 2, -outerSize / 2, outerSize, outerSize);

    if (frameId === 'checker') {
      const tile = 6;
      context.fillStyle = '#f8f5ef';
      for (let x = -outerSize / 2; x < outerSize / 2; x += tile) {
        for (let y = -outerSize / 2; y < outerSize / 2; y += tile) {
          const edge = x < -innerSize / 2 || x >= innerSize / 2 || y < -innerSize / 2 || y >= innerSize / 2;
          if (edge && (Math.round((x + outerSize / 2) / tile) + Math.round((y + outerSize / 2) / tile)) % 2 === 0) {
            context.fillRect(x, y, tile, tile);
          }
        }
      }
    }

    context.save();
    context.beginPath();
    context.rect(-innerSize / 2, -innerSize / 2, innerSize, innerSize);
    context.clip();
    if (sourceImage) {
      const rasterSize = effectId === 'pixel' ? 18 : Math.max(1, Math.round(innerSize));
      const raster = document.createElement('canvas');
      raster.width = rasterSize;
      raster.height = rasterSize;
      const rasterContext = raster.getContext('2d');
      if (rasterContext) {
        rasterContext.imageSmoothingEnabled = effectId !== 'pixel';
        paintPhoto(rasterContext, rasterSize);
        context.imageSmoothingEnabled = effectId !== 'pixel';
        context.drawImage(raster, -innerSize / 2, -innerSize / 2, innerSize, innerSize);
        context.imageSmoothingEnabled = true;
      }
    } else {
      drawPlaceholder(context, innerSize);
    }
    context.restore();

    context.strokeStyle = frameId === 'bubblegum' ? '#fff4fb' : '#17131b';
    context.lineWidth = frameId === 'ink' ? 2 : 1;
    context.strokeRect(-innerSize / 2, -innerSize / 2, innerSize, innerSize);
    if (frameId === 'bubblegum') {
      context.strokeStyle = '#76234e';
      context.lineWidth = 1;
      context.strokeRect(-outerSize / 2 + 2, -outerSize / 2 + 2, outerSize - 4, outerSize - 4);
    }
    context.restore();

    if (sparkles) {
      drawStar(context, 15, 17, 8, '#fff8b5');
      drawStar(context, 87, 27, 5, '#ffffff');
      drawStar(context, 78, 84, 4, '#fff8b5');
    }

    const label = stamp.trim().slice(0, 10).toUpperCase();
    if (label) {
      context.save();
      context.translate(50, 86);
      context.font = '700 8px Silkscreen, monospace';
      const labelWidth = Math.min(88, Math.max(42, context.measureText(label).width + 14));
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#211c29';
      context.lineWidth = 1;
      context.fillRect(-labelWidth / 2, -8, labelWidth, 16);
      context.strokeRect(-labelWidth / 2, -8, labelWidth, 16);
      context.fillStyle = '#211c29';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, 0, 0.5);
      context.restore();
    }
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
      sourceImage = await imageFromUrl(data.currentAvatar);
      sourceName = 'current-avatar.png';
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

  function randomize(): void {
    const frame = frames[Math.floor(Math.random() * frames.length)];
    selectFrame(frame);
    effectId = effects[Math.floor(Math.random() * effects.length)].id;
    borderWidth = 7 + Math.floor(Math.random() * 7);
    rotation = -7 + Math.round(Math.random() * 14);
    skew = -16 + Math.round(Math.random() * 32);
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
    const deltaX = event.clientX - dragX;
    const deltaY = event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    positionX = clamp(positionX + deltaX * 1.5, -100, 100);
    positionY = clamp(positionY + deltaY * 1.5, -100, 100);
  }

  function endDrag(event: PointerEvent): void {
    if (dragPointer !== event.pointerId) return;
    dragPointer = null;
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
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
    <span class="atm-crumbs__current">avatar builder</span>
  </nav>

  <header class="intro">
    <div>
      <span class="kicker">AVATAR BUILDER</span>
      <h1>100 × 100 pixel avatar</h1>
      <p>Upload an image, crop it, and add a frame.</p>
    </div>
    <button class="randomize" type="button" onclick={randomize} aria-label="Randomize avatar style">randomize style</button>
  </header>

  <div class="builder">
    <section class="preview-panel" aria-labelledby="preview-title">
      <div class="window-bar">
        <span id="preview-title">LIVE PREVIEW</span>
        <span>100 × 100 PNG</span>
      </div>
      <div class="preview-stage">
        <div class="size-badge">100 × 100 PX</div>
        <canvas
          bind:this={canvas}
          width="100"
          height="100"
          class:dragging
          class:ready
          aria-label="Avatar preview"
          onpointerdown={startDrag}
          onpointermove={moveDrag}
          onpointerup={endDrag}
          onpointercancel={endDrag}
        ></canvas>
        <span class="drag-note">{ready ? 'drag image to reposition' : 'your image appears here'}</span>
      </div>

      <label
        class="dropzone"
        for="source-image"
        ondragover={(event) => event.preventDefault()}
        ondrop={handleDrop}
      >
        <span class="dropzone__icon" aria-hidden="true">↥</span>
        <span>
          <b>{sourceName || 'Drop an image here'}</b>
          <small>{sourceName ? 'Click to choose another image' : 'or click to choose one'}</small>
        </span>
        <input
          id="source-image"
          class="source-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onchange={(event) => void useFile(event.currentTarget.files?.[0])}
        />
      </label>
      {#if data.currentAvatar}
        <button class="use-current" type="button" onclick={useCurrentAvatar}>Start with my current avatar</button>
      {/if}
      <p class="photo-note">PNG, JPEG, WebP, or GIF. Use an image you’re allowed to share.</p>
    </section>

    <section class="controls" aria-label="Avatar controls">
      <fieldset>
        <legend><span>01</span> Pick a frame</legend>
        <div class="frame-grid">
          {#each frames as frame}
            <button
              type="button"
              class:active={frame.id === frameId}
              aria-pressed={frame.id === frameId}
              onclick={() => selectFrame(frame)}
            >
              <span class="frame-swatch frame-swatch--{frame.id}" style="--swatch:{frame.frame};--backdrop:{frame.background}"></span>
              <span><b>{frame.name}</b><small>{frame.note}</small></span>
            </button>
          {/each}
        </div>
      </fieldset>

      <fieldset>
        <legend><span>02</span> Choose an effect</legend>
        <div class="effect-row">
          {#each effects as effect}
            <button
              type="button"
              class:active={effect.id === effectId}
              aria-pressed={effect.id === effectId}
              onclick={() => (effectId = effect.id)}
            >{effect.name}</button>
          {/each}
        </div>
      </fieldset>

      <fieldset>
        <legend><span>03</span> Crop and adjust</legend>
        <div class="sliders">
          <label>
            <span>Zoom <output>{Math.round(zoom * 100)}%</output></span>
            <input type="range" min="1" max="3" step="0.01" bind:value={zoom} />
          </label>
          <label>
            <span>Left / right <output>{positionX}</output></span>
            <input type="range" min="-100" max="100" step="1" bind:value={positionX} />
          </label>
          <label>
            <span>Up / down <output>{positionY}</output></span>
            <input type="range" min="-100" max="100" step="1" bind:value={positionY} />
          </label>
          <div class="slider-pair">
            <label>
              <span>Skew <output>{skew}°</output></span>
              <input type="range" min="-18" max="18" step="1" bind:value={skew} />
            </label>
            <label>
              <span>Tilt <output>{rotation}°</output></span>
              <input type="range" min="-10" max="10" step="1" bind:value={rotation} />
            </label>
          </div>
        </div>
        <button class="reset-crop" type="button" onclick={resetCrop}>reset crop</button>
      </fieldset>

      <fieldset>
        <legend><span>04</span> Customize the frame</legend>
        <div class="finishing-grid">
          <label class="color-control">
            <span>Border</span>
            <input type="color" bind:value={borderColor} aria-label="Border color" />
            <code>{borderColor}</code>
          </label>
          <label class="color-control">
            <span>Backdrop</span>
            <input type="color" bind:value={backgroundColor} aria-label="Backdrop color" />
            <code>{backgroundColor}</code>
          </label>
          <label class="border-control">
            <span>Border weight <output>{borderWidth}px</output></span>
            <input type="range" min="4" max="14" step="1" bind:value={borderWidth} />
          </label>
          <label class="stamp-control">
            <span>Label</span>
            <input class="atm-input" maxlength="10" bind:value={stamp} placeholder="TEXT" />
          </label>
          <label class="sparkle-control">
            <input type="checkbox" bind:checked={sparkles} />
            <span aria-hidden="true">✦</span> add sparkles
          </label>
        </div>
      </fieldset>
    </section>
  </div>

  <form
    bind:this={saveForm}
    method="POST"
    action="?/save"
    enctype="multipart/form-data"
    class="save-bar"
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
    <div class="save-copy">
      <b>Save your avatar</b>
      <span aria-live="polite">
        {#if localMessage}<span class="atm-err">{localMessage}</span>
        {:else if form?.message}<span class="atm-err">{form.message}</span>
        {:else if form?.saved}<span class="atm-ok">Saved to your profile ✓</span>
        {:else}Your avatar will be saved as a 100 × 100 PNG.{/if}
      </span>
    </div>
    <button class="atm-btn atm-btn--secondary" type="button" disabled={!ready} onclick={downloadAvatar}>Download PNG</button>
    <button class="atm-btn atm-btn--primary" type="button" disabled={!ready || saving} onclick={saveAvatar}>
      {saving ? 'Saving…' : 'Use as my avatar'}
    </button>
  </form>
</div>

<style>
  @layer atmobb {
  .wrap {
    --pixel: 'Silkscreen', 'Courier New', monospace;
    max-width: 980px;
    margin: 0 auto;
  }
  .atm-crumbs a { color: #8b3a20; }

  .intro {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    margin: var(--space-3) 0 var(--space-5);
  }
  .intro h1 {
    margin: 8px 0 7px;
    font: 700 clamp(22px, 4vw, 34px)/1.2 var(--pixel);
    letter-spacing: -0.04em;
    text-transform: lowercase;
  }
  .intro p { color: #43424a; font: var(--type-ui); }
  .kicker {
    color: #8b3a20;
    font: 700 10px/1 var(--pixel);
  }
  .randomize {
    flex: none;
    padding: 10px 12px;
    border: 2px solid var(--forum-ink);
    border-radius: 0;
    background: #b7ff46;
    color: #211c29;
    box-shadow: none;
    font: 700 10px/1 var(--pixel);
    text-transform: uppercase;
    cursor: pointer;
  }
  .randomize:hover { background: #ff83c1; }
  .randomize:active { transform: translateY(1px); }

  .builder {
    display: grid;
    grid-template-columns: minmax(300px, 0.82fr) minmax(420px, 1.18fr);
    border: 2px solid #211c29;
    background: var(--forum-surface);
    box-shadow: none;
  }

  .preview-panel {
    min-width: 0;
    padding-bottom: var(--space-5);
    background: #fff;
    color: #211c29;
    border-right: 2px solid #211c29;
  }
  .window-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 2px solid #211c29;
    background: #ff83c1;
    color: #211c29;
    font: 700 9px/1 var(--pixel);
  }

  .preview-stage {
    display: flex;
    min-height: 355px;
    padding: 28px var(--space-5) var(--space-4);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 11px;
    border-bottom: 2px solid #211c29;
    background: #8ee8ff;
  }
  .size-badge {
    align-self: flex-start;
    margin: 0 0 -1px;
    padding: 5px 7px;
    border: 1px solid #211c29;
    background: #ffe74f;
    color: #211c29;
    font: 700 8px/1 var(--pixel);
  }
  canvas {
    width: min(100%, 300px);
    aspect-ratio: 1;
    border: 2px solid #211c29;
    box-shadow: none;
    image-rendering: pixelated;
    touch-action: none;
  }
  canvas.ready { cursor: grab; }
  canvas.dragging { cursor: grabbing; }
  .drag-note { color: #211c29; font: 600 11px/1 var(--font-body); text-transform: uppercase; letter-spacing: .04em; }

  .dropzone {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-4) var(--space-5) 0;
    padding: var(--space-3);
    border: 2px solid #211c29;
    background: #fff;
    color: #211c29;
    cursor: pointer;
  }
  .dropzone:hover { background: #ffe74f; }
  .dropzone__icon { display: grid; width: 35px; height: 35px; flex: none; place-items: center; border: 1px solid #211c29; background: #b7ff46; font: 22px/1 var(--pixel); }
  .dropzone > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .dropzone b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 700 9px/1.4 var(--pixel); }
  .dropzone small { color: #43424a; font: 11px/1.2 var(--font-body); }
  .source-input, .rendered-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .use-current {
    display: block;
    margin: 10px auto 0;
    border: 0;
    padding: 2px;
    color: #73351f;
    background: none;
    font: 11px/1.2 var(--font-body);
    text-decoration: underline;
    cursor: pointer;
  }
  .photo-note { margin: 9px var(--space-5) 0; text-align: center; color: #43424a; font: 11px/1.3 var(--font-body); }

  .controls { min-width: 0; padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-5); background: #fff; }
  fieldset { min-width: 0; margin: 0; padding: 0 0 var(--space-5); border: 0; border-bottom: 2px solid #211c29; }
  fieldset:last-child { padding-bottom: 0; border-bottom: 0; }
  legend {
    width: 100%;
    margin-bottom: var(--space-3);
    color: var(--forum-ink);
    font: 700 10px/1 var(--pixel);
    text-transform: uppercase;
  }
  legend span { display: inline-grid; width: 24px; height: 20px; margin-right: 7px; place-items: center; border: 1px solid #211c29; background: #ffe74f; color: #211c29; }

  .frame-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .frame-grid button {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    padding: 8px;
    text-align: left;
    border: 1px solid #211c29;
    border-radius: 0;
    background: #fff;
    color: var(--forum-ink);
    cursor: pointer;
  }
  .frame-grid button:hover { background: #f4f2ef; }
  .frame-grid button.active { border-color: #211c29; box-shadow: inset 0 0 0 1px #211c29; background: #ff83c1; }
  .frame-grid button.active small { color: #211c29; }
  .frame-grid button > span:last-child { display: flex; min-width: 0; flex-direction: column; }
  .frame-grid b { font: 700 9px/1.4 var(--pixel); text-transform: uppercase; }
  .frame-grid small { color: #43424a; font: 11px/1.2 var(--font-body); }
  .frame-swatch { position: relative; width: 34px; height: 34px; flex: none; border: 7px solid var(--swatch); background: #8ee8ff; outline: 4px solid var(--backdrop); outline-offset: -4px; }
  .frame-swatch--chrome { border-color: #315dff; }
  .frame-swatch--checker { border-image: conic-gradient(#171717 25%, #fff 0 50%, #171717 0 75%, #fff 0) 1; }

  .effect-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .effect-row button {
    padding: 8px 10px;
    border: 1px solid #211c29;
    border-radius: 0;
    background: var(--forum-surface);
    color: #211c29;
    font: 400 9px/1 var(--pixel);
    text-transform: uppercase;
    cursor: pointer;
  }
  .effect-row button:hover { background: #f4f2ef; }
  .effect-row button.active { border-color: #211c29; background: #315dff; color: #fff; }

  .sliders { display: grid; gap: 10px; }
  .sliders label, .border-control { display: flex; flex-direction: column; gap: 5px; }
  .sliders label > span, .border-control > span {
    display: flex;
    justify-content: space-between;
    color: #43424a;
    font: var(--w-medium) 12px/1 var(--font-body);
  }
  output { color: var(--forum-ink); font: 400 11px/1 var(--font-mono); }
  input[type="range"] { width: 100%; accent-color: #315dff; cursor: ew-resize; }
  .slider-pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
  .reset-crop { margin-top: 10px; padding: 0; border: 0; background: none; color: #73351f; font: 600 11px/1 var(--font-body); text-decoration: underline; cursor: pointer; }

  .finishing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3) var(--space-4); }
  .color-control { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 8px; }
  .color-control > span, .stamp-control > span { color: #43424a; font: var(--w-medium) 12px/1 var(--font-body); }
  .color-control input { grid-row: span 2; width: 38px; height: 34px; padding: 2px; border: 1px solid #211c29; border-radius: 0; background: var(--forum-surface); cursor: pointer; }
  .color-control code { color: #43424a; font-size: 11px; text-transform: uppercase; }
  .stamp-control { display: flex; flex-direction: column; gap: 5px; }
  .stamp-control .atm-input { padding-block: 7px; border-color: #211c29; border-radius: 0; font: 400 9px/1 var(--pixel); text-transform: uppercase; }
  .sparkle-control { align-self: end; display: flex; align-items: center; gap: 6px; min-height: 32px; color: var(--forum-ink); font: 400 9px/1 var(--pixel); cursor: pointer; }
  .sparkle-control input { accent-color: #315dff; }
  .sparkle-control span { color: #8b3a20; }

  .save-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-4);
    padding: var(--space-4);
    border: 2px solid #211c29;
    background: #ffe74f;
    box-shadow: none;
  }
  .save-copy { display: flex; min-width: 0; margin-right: auto; flex-direction: column; gap: 3px; }
  .save-copy b { font: 700 9px/1 var(--pixel); }
  .save-copy > span { color: #43424a; font: 11px/1.3 var(--font-body); }
  .save-bar .atm-btn { border: 1px solid #211c29; border-radius: 0; box-shadow: none; }
  .save-bar .atm-btn--secondary { background: #fff; }
  .save-bar .atm-btn--primary { background: #211c29; color: #fff; }

  @media (max-width: 780px) {
    .builder { grid-template-columns: 1fr; }
    .preview-panel { border-right: 0; border-bottom: 2px solid #211c29; }
    .preview-stage { min-height: 340px; }
  }
  @media (max-width: 560px) {
    .intro { align-items: start; flex-direction: column; }
    .randomize { align-self: flex-end; margin-top: -8px; }
    .preview-stage { min-height: auto; padding-inline: var(--space-4); }
    canvas { width: min(100%, 280px); }
    .controls { padding: var(--space-4); }
    .frame-grid, .finishing-grid { grid-template-columns: 1fr; }
    .save-bar { align-items: stretch; flex-direction: column; }
    .save-copy { margin: 0 0 var(--space-2); }
    .save-bar .atm-btn { width: 100%; }
  }
  }
</style>
