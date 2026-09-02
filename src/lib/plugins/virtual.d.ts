declare module 'virtual:atmobb/plugins/metadata' {
  import type { SettingsPluginMetadata } from '$lib/plugins/api';
  export const settingsPlugins: SettingsPluginMetadata[];
}

declare module 'virtual:atmobb/plugins/settings-client' {
  import type { Component } from 'svelte';
  import type { PluginSettingsPageProps } from '$lib/plugins/api';
  export const settingsPluginPages: Map<string, Component<PluginSettingsPageProps>>;
}

declare module 'virtual:atmobb/plugins/avatar-client' {
  import type { Component } from 'svelte';
  import type { PluginAvatarProviderProps } from '$lib/plugins/api';
  export const AvatarProvider: Component<PluginAvatarProviderProps> | null;
}

declare module 'virtual:atmobb/plugins/server' {
  import type { PluginAvatarServerModule, PluginSettingsServerModule } from '$lib/plugins/api';
  export const settingsPluginServers: Map<string, PluginSettingsServerModule>;
  export const avatarPluginServer: PluginAvatarServerModule | null;
}
