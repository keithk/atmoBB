import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clientMetadata } from '$lib/server/atproto-oauth';

export const GET: RequestHandler = () => json(clientMetadata());
