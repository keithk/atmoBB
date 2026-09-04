import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// Which release this forum runs, and which Happyview release it was tested
// against. Operators check it after an upgrade; the directory can use it to
// see what the network is actually running. Nothing here is secret.
export const GET: RequestHandler = () =>
  json(
    {
      version: __ATMOBB_VERSION__,
      happyview: env.HAPPYVIEW_EXPECTED_VERSION ?? null,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
