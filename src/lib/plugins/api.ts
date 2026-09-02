export interface PluginUser {
  did: string;
  handle: string;
}

export interface PluginProfile {
  avatar?: unknown;
  [key: string]: unknown;
}

export interface PluginProfileApi {
  get(): Promise<PluginProfile | null>;
  uploadBlob(bytes: Uint8Array, mimeType: string): Promise<unknown>;
  patch(fields: Record<string, unknown>, remove?: string[]): Promise<void>;
}

export interface PluginSettingsContext {
  user: PluginUser;
  request: Request;
  url: URL;
  profile: PluginProfileApi;
}

export interface PluginSettingsServerModule {
  load?(context: Omit<PluginSettingsContext, 'request'>): unknown | Promise<unknown>;
  action?(context: PluginSettingsContext): unknown | Promise<unknown>;
}

export interface PluginSettingsPageProps {
  data: unknown;
  form: unknown;
}

export interface PluginSettingsCapability {
  label: string;
  description?: string;
  /** Where the link appears in core settings. Defaults to the profile extensions list. */
  section?: 'avatar' | 'profile';
  /** Absolute path to a Svelte component with PluginSettingsPageProps. */
  client: string;
  /** Absolute path to a module implementing PluginSettingsServerModule. */
  server?: string;
}

export interface PluginAvatarProviderProps {
  seed: string;
  profile?: PluginProfile | null;
  src?: string | null;
  alt: string;
  size: number;
}

export interface PluginVNode {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

export interface PluginAvatarOptions {
  size: number;
  ring?: boolean;
  presence?: 'online' | 'idle' | 'offline';
  radius?: number;
}

export interface PluginOgAvatarContext {
  profile: PluginProfile | null | undefined;
  did: string;
  label: string;
  fetch: typeof fetch;
  options: PluginAvatarOptions;
  defaultAvatar(): Promise<PluginVNode>;
}

export interface PluginAvatarServerModule {
  renderAvatar?(context: PluginOgAvatarContext): PluginVNode | null | Promise<PluginVNode | null>;
}

export interface PluginAvatarCapability {
  /** Absolute path to a Svelte component with PluginAvatarProviderProps. */
  client: string;
  /** Optional absolute path to a module implementing PluginAvatarServerModule. */
  server?: string;
}

export interface PluginSetupContext {
  /** Root of the atmobb checkout being built. */
  rootDirectory: string;
  /** Empty, plugin-owned directory exposed publicly at /plugins/<id>/. */
  publicDirectory: string;
}

export interface AtmobbPlugin {
  id: string;
  name: string;
  setup?(context: PluginSetupContext): void | Promise<void>;
  settings?: PluginSettingsCapability;
  avatar?: PluginAvatarCapability;
}

export interface AtmobbConfig {
  plugins?: AtmobbPlugin[];
}

export interface SettingsPluginMetadata {
  id: string;
  name: string;
  label: string;
  description?: string;
  section: 'avatar' | 'profile';
  href: string;
}
