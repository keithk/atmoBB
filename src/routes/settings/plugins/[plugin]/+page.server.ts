import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { settingsPluginServers } from 'virtual:atmobb/plugins/server';
import { settingsPlugins } from 'virtual:atmobb/plugins/metadata';
import { pluginSettingsContext } from '$lib/server/plugin-context';

export const load: PageServerLoad = async ({ params, locals, request, url }) => {
  if (!locals.user) redirect(302, '/login');
  const plugin = settingsPlugins.find((candidate) => candidate.id === params.plugin);
  if (!plugin) error(404, 'Plugin settings not found.');
  const server = settingsPluginServers.get(params.plugin);
  const context = pluginSettingsContext(locals.user, request, url);
  const pluginData = server?.load ? await server.load(context) : null;
  return {
    metadata: { title: plugin.label, description: plugin.description, noindex: true },
    plugin,
    pluginData,
  };
};

export const actions: Actions = {
  default: async ({ params, locals, request, url }) => {
    if (!locals.user) redirect(303, '/login');
    const plugin = settingsPlugins.find((candidate) => candidate.id === params.plugin);
    if (!plugin) error(404, 'Plugin settings not found.');
    const action = settingsPluginServers.get(params.plugin)?.action;
    if (!action) error(405, "This plugin doesn't accept settings changes.");
    return action(pluginSettingsContext(locals.user, request, url));
  },
};
