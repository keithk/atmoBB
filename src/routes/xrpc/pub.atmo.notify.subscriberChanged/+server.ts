import type { RequestHandler } from './$types';
import { handleSubscriberChanged } from '$lib/server/notify/webhook';

// atmo.pub tells us a member granted or revoked this forum. The checks live in
// webhook.ts so they can be tested without the SvelteKit runtime.
export const POST: RequestHandler = ({ request }) => handleSubscriberChanged(request);
