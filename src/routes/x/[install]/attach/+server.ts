import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isObject } from '$lib/extensions/contract';
import { attachThread } from '$lib/server/extensions/attach';
import { forumJsonPostProblem } from '$lib/server/extensions/requests';

// Staff attach an extension to a thread with the setup its attach form
// collected: POST { thread: <at-uri>, params: <any JSON> }. SvelteKit's own
// CSRF check covers form posts only, so this takes JSON alone and requires
// the request to come from the forum's own origin.

const refuse = (status: number, message: string) => json({ message }, { status });

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const problem = forumJsonPostProblem(request);
  if (problem === 'origin') return refuse(403, 'Attach requests must come from this forum.');
  if (problem === 'media-type') return refuse(415, 'Send the attach request as JSON.');

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
