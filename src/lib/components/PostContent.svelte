<script lang="ts">
  import { onMount, tick, type ComponentProps } from 'svelte';
  import RichText from './RichText.svelte';

  let { postUri, ...props }: ComponentProps<typeof RichText> & { postUri: string } = $props();
  const id = $props.id();
  let content: HTMLDivElement;
  let measure: HTMLDivElement;
  let expanded = $state(false);
  let overflows = $state(false);
  const collapsed = $derived(overflows && !expanded);

  // A reused route/component must not carry expansion into a different post.
  $effect(() => {
    postUri;
    expanded = false;
  });

  onMount(() => {
    const update = () => {
      const limit = measure.getBoundingClientRect().height;
      // Avoid folding a post just to hide its final line.
      overflows = limit > 0 && content.scrollHeight > limit + 48;
    };
    const observer = new ResizeObserver(update);
    observer.observe(content);
    observer.observe(measure);
    update();
    return () => observer.disconnect();
  });

  async function expand() {
    expanded = true;
    await tick();
    // Keep keyboard focus in this post without jumping to its newly revealed end.
    content.focus({ preventScroll: true });
  }

  function revealFocusedContent(event: FocusEvent) {
    // A clipped link/spoiler must never receive invisible keyboard focus.
    if (event.target !== content) expanded = true;
  }
</script>

<div class="atm-post-content" class:atm-post-content--collapsed={collapsed}>
  <div class="atm-post-content__measure" bind:this={measure} aria-hidden="true"></div>
  <div class="atm-post-content__preview">
    <div
      class="atm-post-content__text"
      id={id}
      bind:this={content}
      tabindex="-1"
      onfocusin={revealFocusedContent}
    >
      <RichText {...props} />
    </div>
  </div>
  {#if collapsed}
    <button
      type="button"
      class="atm-post-content__expand"
      aria-expanded="false"
      aria-controls={id}
      onclick={expand}
    >
      <span>Read full post</span>
      <svg class="atm-post-content__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  {/if}
</div>
