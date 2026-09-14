import { env } from '$env/dynamic/private';

// SvelteKit's own CSRF check covers form posts only, so the JSON endpoints a
// forum page posts to check the origin and media type themselves.

/**
 * Why a JSON POST from a forum page should be refused before its body is read:
 * `origin` when it didn't come from ATMOBB_APP_URL's origin (or that isn't
 * set), `media-type` when it isn't `application/json`. Null when it may go on.
 */
export function forumJsonPostProblem(request: Request): 'origin' | 'media-type' | null {
  const origin = env.ATMOBB_APP_URL ? new URL(env.ATMOBB_APP_URL).origin : null;
  if (!origin || request.headers.get('origin') !== origin) return 'origin';
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return 'media-type';
  return null;
}
