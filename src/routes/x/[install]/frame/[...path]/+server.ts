import type { RequestHandler } from './$types';
import { frameResponse } from '$lib/server/extensions/frame';

// An extension's UI files, for its sandboxed panel frame. See frame.ts for
// what each request destination may load.

// A trailing slash is answered, never redirected, so nothing under a frame URL moves.
export const trailingSlash = 'ignore';

export const GET: RequestHandler = ({ params, request, url }) =>
  frameResponse({ installId: params.install, path: params.path, headers: request.headers, origin: url.origin });
