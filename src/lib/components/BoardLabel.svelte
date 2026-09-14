<script lang="ts">
  import { page } from '$app/state';
  import BoardMarker from './BoardMarker.svelte';

  let { uri, name, board }: {
    uri?: string;
    name?: string;
    board?: { name: string; color?: string; emoji?: string };
  } = $props();
  const metadata = $derived(board ?? page.data.sidebarBoards?.find((b) => b.uri === uri)?.value);
</script>

<span class="board-label">
  {#if metadata?.emoji}<span aria-hidden="true">{metadata.emoji}</span>{/if}
  <span class="board-label__name"><BoardMarker color={metadata?.color} />{name ?? metadata?.name ?? 'Board'}</span>
</span>

<style>
  @layer atmobb {
    .board-label { display: inline; }
    .board-label > span + span { margin-left: 0.25em; }
    .board-label__name :global(.atm-board-marker) { margin-right: 0.25em; }
  }
</style>
