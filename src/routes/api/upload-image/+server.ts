import { error, json } from '@sveltejs/kit';
import { lexToJson } from '@atproto/api';
import type { RequestHandler } from './$types';
import { agentFor } from '$lib/server/atproto-oauth';

// Matches the richtext.block#image lexicon's blob maxSize.
const MAX_BYTES = 2_000_000;

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'Log in to upload images.');

  const form = await request.formData();
  const file = form.get('image');
  if (!(file instanceof File)) throw error(400, 'Choose an image to upload.');
  if (!file.type.startsWith('image/')) throw error(415, 'That file is not an image.');
  if (file.size > MAX_BYTES) throw error(413, 'Images must be 2 MB or smaller.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const did = locals.user.did;

  let blob;
  try {
    const agent = await agentFor(did);
    const uploaded = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: file.type });
    blob = uploaded.data.blob;
  } catch (e) {
    throw error(502, e instanceof Error ? e.message : 'The image upload failed. Try again.');
  }

  const cid = blob.ref.toString();

  return json({ blob: lexToJson(blob), cid });
};
