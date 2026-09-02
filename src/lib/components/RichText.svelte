<script lang="ts">
  import SpoilerSpan from './SpoilerSpan.svelte';
  import MemberLink from './MemberLink.svelte';
  import type { Facet, FacetFeature, RichTextBlock } from '$lib/richtext/bbcode';
  import { postAuthor, postPath } from '$lib/appview-paths';

  let {
    body = [],
    threadUri,
    handles = {},
  }: {
    body?: RichTextBlock[];
    /** The thread this body is shown in, so attributed quotes can link to the quoted post. */
    threadUri?: string;
    /** DID → handle, for naming quoted authors. */
    handles?: Record<string, string>;
  } = $props();

  const nameOf = (did: string) => handles[did] ?? did.replace(/^did:[a-z]+:/, '').slice(0, 12) + '…';

  interface Segment {
    text: string;
    features: FacetFeature[];
  }

  /** Split `text` at every facet boundary so each segment has a fixed feature set. */
  function segment(text: string, facets: Facet[] = []): Segment[] {
    const bytes = new TextEncoder().encode(text);
    const decoder = new TextDecoder();
    const bounds = new Set([0, bytes.length]);
    for (const f of facets) {
      bounds.add(Math.max(0, Math.min(bytes.length, f.index.byteStart)));
      bounds.add(Math.max(0, Math.min(bytes.length, f.index.byteEnd)));
    }
    const points = [...bounds].sort((a, b) => a - b);
    const out: Segment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [s, e] = [points[i], points[i + 1]];
      if (s >= e) continue;
      const features = facets.filter((f) => f.index.byteStart <= s && f.index.byteEnd >= e).flatMap((f) => f.features);
      out.push({ text: decoder.decode(bytes.slice(s, e)), features });
    }
    return out;
  }

  const kindOf = (feature: FacetFeature) => feature.$type.split('#')[1];
  const has = (features: FacetFeature[], kind: string) => features.some((f) => kindOf(f) === kind);

  /** Only allow http(s)/mailto hrefs — a bare [url=] is fully user-controlled text. */
  function safeHref(features: FacetFeature[]): string | undefined {
    const link = features.find((f) => kindOf(f) === 'link');
    if (!link?.uri || !/^(https?:|mailto:)/i.test(link.uri)) return undefined;
    return link.uri;
  }

  /** The mentioned DID, if this run is an @mention. */
  const mentionDid = (features: FacetFeature[]) =>
    features.find((f) => kindOf(f) === 'mention')?.did;
</script>

{#snippet styled(seg: Segment)}
  <span
    class:rt-bold={has(seg.features, 'bold')}
    class:rt-italic={has(seg.features, 'italic')}
    class:rt-underline={has(seg.features, 'underline')}
    class:rt-strike={has(seg.features, 'strikethrough')}
    class:rt-code={has(seg.features, 'code')}
  >{seg.text}</span>
{/snippet}

{#snippet run(seg: Segment)}
  {@const href = safeHref(seg.features)}
  {@const did = mentionDid(seg.features)}
  {#if has(seg.features, 'spoiler')}
    <SpoilerSpan>{@render styled(seg)}</SpoilerSpan>
  {:else if did}
    <MemberLink {did} class="rt-mention">{@render styled(seg)}</MemberLink>
  {:else if href}
    <a {href} target="_blank" rel="noopener noreferrer">{@render styled(seg)}</a>
  {:else}
    {@render styled(seg)}
  {/if}
{/snippet}

<div class="atm-richtext">
  {#each body as block}
    {#if block.$type.endsWith('#quote')}
      <blockquote class="rt-quote">
        {#if block.subject}
          <cite class="rt-cite">
            {#if threadUri}<a href={postPath(threadUri, block.subject.uri)}>↩</a>{/if}
            <MemberLink did={postAuthor(block.subject.uri)}>@{nameOf(postAuthor(block.subject.uri))}</MemberLink> wrote:
          </cite>
        {/if}
        {#each segment(block.text ?? '', block.facets) as seg}{@render run(seg)}{/each}
      </blockquote>
    {:else if block.$type.endsWith('#code')}
      <pre class="rt-codeblock"><code>{block.text}</code></pre>
    {:else if block.$type.endsWith('#image')}
      {#if block.url}
        <img class="rt-image" src={block.url} alt={block.alt ?? ''} loading="lazy" />
      {/if}
    {:else}
      <p class="rt-p">
        {#each segment(block.text ?? '', block.facets) as seg}{@render run(seg)}{/each}
      </p>
    {/if}
  {/each}
</div>

<style>
  @layer atmobb {
  .atm-richtext { font: var(--type-body); }
  .rt-p { margin: 0 0 var(--space-3); white-space: pre-wrap; overflow-wrap: anywhere; }
  .rt-p:last-child { margin-bottom: 0; }

  /* block-level quote/pre chrome comes from .atm-richtext in content.css */
  .rt-quote { white-space: pre-wrap; overflow-wrap: anywhere; }
  .rt-cite { display: block; font: var(--type-meta); color: var(--forum-ink-soft); margin-bottom: var(--space-1); }
  .rt-cite a { text-decoration: none; }

  .rt-image {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-xs);
    margin: 0 0 var(--space-3);
  }

  .rt-bold { font-weight: var(--w-bold); }
  .rt-italic { font-style: italic; }
  .rt-underline { text-decoration: underline; }
  .rt-strike { text-decoration: line-through; }
  .rt-underline.rt-strike { text-decoration: underline line-through; }
  .rt-code {
    font-family: var(--font-mono);
    background: var(--forum-surface-2);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-xs);
    padding: 1px 4px;
  }

  .atm-richtext :global(a) { color: var(--forum-link); }
  .atm-richtext :global(a:hover) { color: var(--forum-link-hover); }
  .atm-richtext :global(a.rt-mention) { font-weight: var(--w-semibold); text-decoration: none; }
  .atm-richtext :global(a.rt-mention:hover) { text-decoration: underline; }
  }
</style>
