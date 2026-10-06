// Separate process proves persisted SDK sessions are sufficient for Agent routing.
// Network responses remain synthetic; no refresh or real PDS access is claimed.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Agent } from '@atproto/api';
import { HappyViewNodeClient } from '@happyview/oauth-client-node';
import { verifyProof } from './proof.mjs';

const [directory, did] = process.argv.slice(2);
const expected = JSON.parse(await readFile(join(directory, encodeURIComponent(`happyview:session:${did}`)), 'utf8'));
let observed;
const client = new HappyViewNodeClient({
  instanceUrl: 'https://happyview.example.test',
  clientId: 'https://forum.example.test/oauth-client-metadata.json',
  clientKey: 'synthetic-client',
  redirectUri: 'https://forum.example.test/oauth/callback',
  storage: {
    get: (key) => readFile(join(directory, encodeURIComponent(key)), 'utf8'),
    set: async () => { throw new Error('Restore unexpectedly mutated storage'); },
    delete: async () => { throw new Error('Restore unexpectedly revoked a session'); },
  },
  fetch: async (url, init) => {
    const request = new Request(url, init);
    if (new URL(request.url).origin !== 'https://happyview.example.test') throw new Error('Unexpected destination');
    await verifyProof(request, expected.dpopKey, expected.accessToken);
    observed = { did, destination: new URL(request.url).origin, method: request.method };
    return Response.json({ token: 'synthetic-service-auth' });
  },
});
const session = await client.restore(did);
await new Agent(session).com.atproto.server.getServiceAuth({ aud: 'did:web:relay.atmo.pub#notif_relay' });
console.log(JSON.stringify(observed));
