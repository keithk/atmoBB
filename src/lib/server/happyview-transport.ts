import { outboundFetch } from './extensions/outbound';

const MAX_OAUTH_RESPONSE_BYTES = 1024 * 1024;
const OAUTH_REQUEST_TIMEOUT_MS = 10_000;

interface Options {
  instanceUrl: string;
  appUrl: string;
  clientKey: string;
  /** Test seam only. Production never supplies this: external traffic uses outboundFetch. */
  fetch?: typeof globalThis.fetch;
}

/** One network boundary for every SDK resolver, discovery, OAuth and session request. */
export function happyViewTransport(options: Options): typeof globalThis.fetch {
  const instance = new URL(options.instanceUrl);
  const basePath = instance.pathname.replace(/\/+$/, '');
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.username || url.password || url.hash) throw new Error('OAuth request URL contains credentials or a fragment.');
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    headers.delete('host');
    headers.delete('proxy-authorization');
    if (headers.has('x-client-secret')) throw new Error('The web OAuth client must not send a client secret.');

    if (url.origin === instance.origin) {
      // The configured instance may be internal HTTP. That exception belongs only
      // to SDK HappyView operations, never to an attacker-supplied DID/PDS/AS URL.
      const path = url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : '';
      const clientKey = headers.get('x-client-key') === options.clientKey;
      const authenticated = clientKey && /^DPoP \S+$/.test(headers.get('authorization') ?? '') && headers.has('dpop');
      const registration = clientKey && request.method === 'POST'
        && (path === '/oauth/dpop-keys' || path === '/oauth/sessions');
      const session = authenticated && /^(GET|DELETE)$/.test(request.method) && /^\/oauth\/sessions\/[^/]+$/.test(path);
      const xrpc = authenticated && /^(GET|POST)$/.test(request.method) && /^\/xrpc\/[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+){2,}$/.test(path);
      const spaces = authenticated && /^(GET|POST|PUT|PATCH|DELETE)$/.test(request.method) && /^\/spaces(?:\/|$)/.test(path);
      if ((!registration && !session && !xrpc && !spaces) || !/^https?:$/.test(url.protocol)) {
        throw new Error('Refusing an unexpected request to the configured HappyView server.');
      }
      headers.set('origin', new URL(options.appUrl).origin);
      const send = options.fetch ?? globalThis.fetch;
      return send(new Request(request, {
        headers, redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS)]),
      }));
    }

    if (url.protocol !== 'https:') throw new Error('External OAuth requests require HTTPS.');
    if (headers.has('x-client-key') || headers.has('authorization')) {
      throw new Error('Refusing to forward HappyView credentials to another server.');
    }
    if (request.method !== 'GET' && request.method !== 'POST') throw new Error('Unexpected external OAuth request method.');
    headers.delete('origin');
    const external = new Request(request, { headers, redirect: 'error' });
    if (options.fetch) return options.fetch(external);
    const result = await outboundFetch(url.href, {
      method: external.method,
      headers: Object.fromEntries(external.headers),
      body: external.body ? new Uint8Array(await external.arrayBuffer()) : undefined,
      maxBytes: MAX_OAUTH_RESPONSE_BYTES,
      timeoutMs: OAUTH_REQUEST_TIMEOUT_MS,
      totalTimeoutMs: OAUTH_REQUEST_TIMEOUT_MS,
      redirect: 'error',
    });
    return new Response(result.status === 204 || result.status === 205 || result.status === 304 ? null : new Uint8Array(result.body), {
      status: result.status, headers: result.headers,
    });
  };
}
