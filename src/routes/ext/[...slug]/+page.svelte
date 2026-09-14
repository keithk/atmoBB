<script lang="ts">
  import ExtensionPanel from '$lib/components/ExtensionPanel.svelte';
  import { page } from '$app/state';

  let { data } = $props();
</script>

<nav class="atm-crumbs atm-crumbs--spaced">
  <a href="/">{page.data.forum.name}</a><span class="atm-crumbs__sep">›</span>
  <span class="atm-crumbs__current">{data.panel.name}</span>
</nav>

<!-- Keyed so reloading the page's data never remounts the frame. -->
{#key `${data.panel.installId}:${data.path}`}
  <ExtensionPanel {...data.panel} mode="page" path={data.path} signedIn={data.signedIn} />
{/key}
