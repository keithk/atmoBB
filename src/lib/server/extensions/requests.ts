import { env } from '$env/dynamic/private';

// SvelteKit's own CSRF check covers form posts only, so the JSON endpoints a
// forum page posts to check the origin and media type themselves.

/**
 * Why a JSON POST from a forum page should be refused before its body is read:
 * `origin` when it didn't come from the forum's origin, `media-type` when it
 * isn't `application/json`. Null when it may go on. The forum's origin is
 * ATMOBB_APP_URL's, or the request URL's own when that isn't set, as on a
 * local dev server; that fallback is the same comparison SvelteKit's CSRF
 * check makes for form posts.
 */
export function forumJsonPostProblem(request: Request, url: URL): 'origin' | 'media-type' | null {
  const origin = env.ATMOBB_APP_URL ? new URL(env.ATMOBB_APP_URL).origin : url.origin;
  if (request.headers.get('origin') !== origin) return 'origin';
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return 'media-type';
  return null;
}
