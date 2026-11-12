<script lang="ts">
  import ExtensionPanel from '$lib/components/ExtensionPanel.svelte';
  import PageBar from '$lib/components/PageBar.svelte';

  let { data } = $props();
</script>

<PageBar title={data.panel.name} />

<!-- Keyed so reloading the page's data never remounts the frame. -->
{#key `${data.panel.installId}:${data.path}`}
  <ExtensionPanel {...data.panel} mode="page" path={data.path} signedIn={data.signedIn} />
{/key}
