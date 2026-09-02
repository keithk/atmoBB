import type { PluginSettingsContext } from '$lib/plugins/api';
import { getActorProfile, patchActorProfile, uploadProfileBlob } from './pds';
import { bustProfileCache } from './profiles';

export function pluginSettingsContext(
  user: { did: string; handle: string },
  request: Request,
  url: URL,
): PluginSettingsContext {
  return {
    user,
    request,
    url,
    profile: {
      get: () => getActorProfile(user.did),
      uploadBlob: (bytes, mimeType) => uploadProfileBlob(user.did, bytes, mimeType),
      patch: async (fields, remove) => {
        await patchActorProfile(user.did, fields, remove);
        bustProfileCache(user.did);
      },
    },
  };
}
