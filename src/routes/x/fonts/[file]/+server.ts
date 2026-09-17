import type { RequestHandler } from './$types';
import { fontsResponse } from '$lib/server/extensions/fonts';

// The forum's fonts, for extension panel frames. See fonts.ts for what each
// request destination may load.

export const GET: RequestHandler = ({ params, request }) => fontsResponse(params.file, request.headers);
