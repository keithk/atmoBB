import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { attachThread } from '$lib/server/extensions/attach';

// Staff attach an extension to a thread with the setup its attach form
// collected: POST { thread: <at-uri>, params: <any JSON> }. SvelteKit's own
// CSRF check covers form posts only, so this takes JSON alone and requires
// the request to come from the forum's own origin.

const refuse = (status: number, message: string) => json({ message }, { status });

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const origin = env.ATMOBB_APP_URL ? new URL(env.ATMOBB_APP_URL).origin : null;
  if (!origin || request.headers.get('origin') !== origin) return refuse(403, 'Attach requests must come from this forum.');
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return refuse(415, 'Send the attach request as JSON.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "The attach request isn't valid JSON.");
  }
  if (!isObject(body) || typeof body.thread !== 'string') return refuse(400, "The attach request needs the thread's at-uri.");

  const result = await attachThread({ installId: params.install, viewerDid: locals.user?.did ?? null, thread: body.thread, params: body.params ?? null });
  if (!result.ok) return refuse(result.status, result.message);
  const { thread, installId, uri } = result.binding;
  return json({ binding: { thread, installId, uri }, result: result.result });
};
