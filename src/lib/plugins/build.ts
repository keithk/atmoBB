import { mkdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';
import type { AtmobbConfig, AtmobbPlugin, SettingsPluginMetadata } from './api.ts';

const IDS = {
  metadata: 'virtual:atmobb/plugins/metadata',
  settingsClient: 'virtual:atmobb/plugins/settings-client',
  server: 'virtual:atmobb/plugins/server',
  avatarClient: 'virtual:atmobb/plugins/avatar-client',
} as const;

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function assertEntry(plugin: AtmobbPlugin, label: string, entry: string | undefined): void {
  if (entry !== undefined && !isAbsolute(entry)) {
    throw new Error(`atmobb plugin "${plugin.id}" ${label} must be an absolute file path`);
  }
}

function validatePlugins(plugins: AtmobbPlugin[]): void {
  const seen = new Set<string>();
  let avatarOwner: string | undefined;
  let avatarSettingsOwner: string | undefined;
  for (const plugin of plugins) {
    if (!ID_PATTERN.test(plugin.id)) {
      throw new Error(`invalid atmobb plugin id "${plugin.id}"; use lowercase letters, numbers, and hyphens`);
    }
    if (seen.has(plugin.id)) throw new Error(`duplicate atmobb plugin id "${plugin.id}"`);
    seen.add(plugin.id);
    if (!plugin.name?.trim()) throw new Error(`atmobb plugin "${plugin.id}" needs a name`);
    assertEntry(plugin, 'settings client', plugin.settings?.client);
    assertEntry(plugin, 'settings server', plugin.settings?.server);
    assertEntry(plugin, 'avatar client', plugin.avatar?.client);
    assertEntry(plugin, 'avatar server', plugin.avatar?.server);
    if (plugin.settings?.section === 'avatar') {
      if (avatarSettingsOwner) {
        throw new Error(`atmobb plugins "${avatarSettingsOwner}" and "${plugin.id}" both provide avatar settings; only one can be active`);
      }
      avatarSettingsOwner = plugin.id;
    }
    if (plugin.avatar) {
      if (avatarOwner) {
        throw new Error(`atmobb plugins "${avatarOwner}" and "${plugin.id}" both provide avatars; only one can be active`);
      }
      avatarOwner = plugin.id;
    }
  }
}

export async function loadAtmobbPlugins(rootDirectory: string): Promise<AtmobbPlugin[]> {
  const configuredPath = process.env.ATMOBB_CONFIG;
  let config: AtmobbConfig = {};
  if (configuredPath) {
    const absolutePath = resolve(configuredPath);
    const loaded = await import(pathToFileURL(absolutePath).href);
    config = loaded.default ?? loaded;
    if (!config || typeof config !== 'object') {
      throw new Error(`ATMOBB_CONFIG ${absolutePath} must export a configuration object`);
    }
  }

  const plugins = config.plugins ?? [];
  if (!Array.isArray(plugins)) throw new Error('atmobb configuration "plugins" must be an array');
  validatePlugins(plugins);

  // This directory is generated on every build. Keeping it under static makes
  // adapter-node and the Vite dev server handle plugin assets exactly like core assets.
  const publicRoot = join(rootDirectory, 'static', 'plugins');
  await rm(publicRoot, { recursive: true, force: true });
  if (plugins.length) await mkdir(publicRoot, { recursive: true });
  for (const plugin of plugins) {
    const publicDirectory = join(publicRoot, plugin.id);
    await mkdir(publicDirectory, { recursive: true });
    await plugin.setup?.({ rootDirectory, publicDirectory });
  }
  return plugins;
}

function settingsMetadata(plugins: AtmobbPlugin[]): SettingsPluginMetadata[] {
  return plugins.flatMap((plugin) =>
    plugin.settings
      ? [{
          id: plugin.id,
          name: plugin.name,
          label: plugin.settings.label,
          description: plugin.settings.description,
          section: plugin.settings.section ?? 'profile',
          href: `/settings/plugins/${plugin.id}`,
        }]
      : [],
  );
}

function settingsClientModule(plugins: AtmobbPlugin[]): string {
  const pages = plugins.filter((plugin) => plugin.settings);
  const imports = pages.map(
    (plugin, i) => `import SettingsPage${i} from ${JSON.stringify(plugin.settings!.client)};`,
  );
  const entries = pages.map((plugin, i) => `[${JSON.stringify(plugin.id)}, SettingsPage${i}]`);
  return `${imports.join('\n')}\nexport const settingsPluginPages = new Map([${entries.join(',')}]);\n`;
}

function serverModule(plugins: AtmobbPlugin[]): string {
  const settings = plugins.filter((plugin) => plugin.settings?.server);
  const avatar = plugins.find((plugin) => plugin.avatar);
  const imports = settings.map(
    (plugin, i) => `import * as SettingsServer${i} from ${JSON.stringify(plugin.settings!.server)};`,
  );
  if (avatar?.avatar?.server) {
    imports.push(`import * as AvatarServer from ${JSON.stringify(avatar.avatar.server)};`);
  }
  const entries = settings.map((plugin, i) => `[${JSON.stringify(plugin.id)}, SettingsServer${i}]`);
  const avatarValue = avatar?.avatar?.server ? 'AvatarServer' : 'null';
  return `${imports.join('\n')}\nexport const settingsPluginServers = new Map([${entries.join(',')}]);\nexport const avatarPluginServer = ${avatarValue};\n`;
}

function avatarClientModule(plugins: AtmobbPlugin[]): string {
  const avatar = plugins.find((plugin) => plugin.avatar);
  if (!avatar) return 'export const AvatarProvider = null;\n';
  return `import AvatarProvider from ${JSON.stringify(avatar.avatar!.client)};\nexport { AvatarProvider };\n`;
}

export function atmobbPluginModules(plugins: AtmobbPlugin[]): Plugin {
  const sources = new Map<string, string>([
    [IDS.metadata, `export const settingsPlugins = ${JSON.stringify(settingsMetadata(plugins))};\n`],
    [IDS.settingsClient, settingsClientModule(plugins)],
    [IDS.server, serverModule(plugins)],
    [IDS.avatarClient, avatarClientModule(plugins)],
  ]);
  return {
    name: 'atmobb-plugins',
    enforce: 'pre',
    resolveId(id) {
      return sources.has(id) ? `\0${id}` : undefined;
    },
    load(id) {
      return id.startsWith('\0') ? sources.get(id.slice(1)) : undefined;
    },
  };
}

export function pluginSourceDirectories(plugins: AtmobbPlugin[]): string[] {
  const entries = plugins.flatMap((plugin) => [
    plugin.settings?.client,
    plugin.settings?.server,
    plugin.avatar?.client,
    plugin.avatar?.server,
  ]);
  return [...new Set(entries.filter((entry): entry is string => !!entry).map(dirname))];
}
