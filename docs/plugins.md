# Plugins

I built the plugin system for one reason: the avatar builder. It's a narrow build-time hook that keeps the builder's code, licensed artwork, and other private inputs outside the public checkout while still letting the builder add its settings page, render avatars, and generate browser-safe assets. It isn't a general extension system, and I'm not planning to turn it into one.

The contracts below are here so a deployment can configure and maintain that integration. Other trusted packages with the same needs can use them too.

> [!CAUTION]
> **A plugin can do anything atmobb can do.**
>
> You don't install these from the admin panel. Setup code runs with the build user's permissions, and server modules run inside the atmobb process alongside your OAuth sessions and your database connection. There is no sandbox.
>
> Install code you have actually read, or code from people you'd trust with the server itself.

## Deployment shape

Keep the checkout, the plugins, the private inputs, and the deployment config in four separate places:

```text
/srv/atmobb/                  public core checkout
/srv/atmobb-plugins/          installed plugin packages
/srv/atmobb-private/          licensed or private plugin inputs
/etc/atmobb/config.mjs        deployment-specific plugin selection
```

Set `ATMOBB_CONFIG` any time you run `check`, `dev`, or `build` for that deployment:

```sh
ATMOBB_CONFIG=/etc/atmobb/config.mjs bun run build
```

Plugins get compiled into the build, so the resulting adapter-node server doesn't need `ATMOBB_CONFIG` at runtime.

An external configuration is an ES module with a default export:

```js
import examplePlugin from '/srv/atmobb-plugins/example/index.mjs';

export default {
  plugins: [
    examplePlugin({ privateSource: '/srv/atmobb-private/example' }),
  ],
};
```

Without `ATMOBB_CONFIG`, the build has no optional plugins.

## Plugin definition

A plugin factory returns one definition. Entry points have to be absolute paths, so build them with `fileURLToPath(new URL(..., import.meta.url))`.

```js
import { fileURLToPath } from 'node:url';

const entry = (path) => fileURLToPath(new URL(path, import.meta.url));

export default function examplePlugin(options) {
  return {
    id: 'example',
    name: 'Example plugin',

    async setup({ publicDirectory }) {
      // Called at Vite startup with a fresh directory. Generate or copy only
      // browser-safe output here. Files become /plugins/example/<name>.
    },

    settings: {
      label: 'Configure example',
      description: 'Example account settings.',
      section: 'profile',
      client: entry('./SettingsPage.svelte'),
      server: entry('./settings.server.mjs'),
    },

    avatar: {
      client: entry('./AvatarProvider.svelte'),
      server: entry('./avatar.server.mjs'),
    },
  };
}
```

Plugin IDs start with a lowercase letter and contain only lowercase letters, numbers, and hyphens. They namespace URLs and public directories, so two plugins can't share one. Only one plugin gets to provide the avatar capability.

The actor-profile lexicon still carries an `avatarBuilder` field for schema compatibility. Core doesn't interpret it, but avatar plugins are welcome to use it.

`setup` can read private inputs out of the plugin's closure. It runs during synchronization, development, and production builds, so it has to be deterministic and repeatable. Core wipes `static/plugins/` before setup and hands each plugin its own directory.

## Settings capability

The client entry is a Svelte component that receives:

```ts
{
  data: unknown; // value returned by the server module's load function
  form: unknown; // latest SvelteKit action result
}
```

The server entry can export `load` and `action`:

```js
export async function load({ user, url, profile }) {
  return { profile: await profile.get() };
}

export async function action({ user, request, url, profile }) {
  const form = await request.formData();
  await profile.patch({ title: String(form.get('title') ?? '') });
  return { saved: true };
}
```

Core won't call either function without a signed-in user. The profile API gives you three things: `get()` reads the complete `app.atmobb.actor.profile` record, `uploadBlob(bytes, mimeType)` uploads a blob to the user's PDS and returns its BlobRef, and `patch(fields, remove?)` preserves the record while setting and removing whatever fields the published actor-profile lexicon permits.

Plugin actions take untrusted requests. Validate input, MIME type, size, and schema before you upload or patch anything.

Avatar builders should stash a rendered image BlobRef in the standard `avatar` field alongside whatever private recipe they keep, so the avatar still works on forums that don't run the plugin. Core image uploads strip `avatarBuilder`, so an explicit upload always wins.

The settings route takes its default form action at `/settings/plugins/<plugin-id>`. A capability with `section: 'avatar'` shows up next to the core image upload and owns `/settings/avatar`, and only one plugin can claim it. Without one, that URL opens core's 100 × 100 photo avatar lab. The default `profile` section shows up in Extensions.

## Avatar capability

The client entry replaces the contents of core's avatar frame. Core still owns sizing, frame styles, and presence indicators. The component receives:

```ts
{
  seed: string;
  profile?: Record<string, unknown> | null;
  src?: string | null; // core-resolved standard profile image
  alt: string;
  size: number;
}
```

Avatar providers have to handle every profile state, which is more states than you think. Use the supplied image where it makes sense and always have a fallback for when the plugin-specific data isn't there.

The optional server entry can export `renderAvatar` for Open Graph cards:

```js
export async function renderAvatar(context) {
  // Return a satori-compatible VNode, null, or context.defaultAvatar().
  return context.defaultAvatar();
}
```

The context carries `profile`, `did`, `label`, `fetch`, render `options`, and `defaultAvatar()`. Return `null`, or skip the server entry entirely, and core falls back to its own image/monogram renderer.

## Updates and private assets

Updates leave plugins and private inputs alone as long as they live outside `/srv/atmobb`:

```sh
cd /srv/atmobb
git pull --ff-only
bun install --frozen-lockfile
ATMOBB_CONFIG=/etc/atmobb/config.mjs bun run check
ATMOBB_CONFIG=/etc/atmobb/config.mjs bun run build
sudo systemctl restart atmobb
```

> [!WARNING]
> Everything in `static/plugins/` gets served to browsers. It's gitignored and rebuilt from plugin sources on every build, so never put credentials or licensed source files there. Private inputs belong in `/srv/atmobb-private/`.

Artwork keeps its own license terms. atmobb's MIT license doesn't cover it and can't.
