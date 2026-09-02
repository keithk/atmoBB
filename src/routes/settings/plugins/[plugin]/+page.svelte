<script lang="ts">
  import { settingsPluginPages } from 'virtual:atmobb/plugins/settings-client';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: unknown } = $props();
  const PluginPage = $derived(settingsPluginPages.get(data.plugin.id));
</script>

{#if PluginPage}<PluginPage data={data.pluginData} {form} />{/if}
