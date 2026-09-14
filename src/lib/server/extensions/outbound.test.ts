import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OutboundFetchError,
  didDocumentCacheSizeForTests,
  outboundFetch,
  resetOutboundForTests,
  resolveDidDocument,
  setRequestFnForTests,
  setResolverForTests,
} from './outbound';
import { request as httpRequest } from 'node:http';

// A fake, publicly-routable-looking address (RFC 5737 TEST-NET-3): not in any
// loopback/private/link-local/CGNAT range, so address validation lets it
// through. The request itself never reaches it — setRequestFnForTests below
// redirects the actual socket to the local test server.
const PUBLIC_TEST_ADDRESS = '203.0.113.10';

let server: Server;
let port: number;

/** Point every outbound connection at the local test server, whatever host/address was validated. */
function routeToTestServer() {
  setRequestFnForTests(((options, callback) =>
    httpRequest({ ...options, host: '127.0.0.1', port }, callback)) as Parameters<typeof setRequestFnForTests>[0]);
}

function stubPublicHost(...hostnames: string[]) {
  setResolverForTests(async (hostname) => {
    if (hostnames.includes(hostname)) return [{ address: PUBLIC_TEST_ADDRESS, family: 4 }];
    throw new Error(`unexpected DNS lookup for ${hostname}`);
  });
}

beforeEach(async () => {
  resetOutboundForTests();
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  resetOutboundForTests();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('outboundFetch address checks', () => {
  it.each([
    ['https://127.0.0.1/'],
    ['https://169.254.169.254/'],
    ['https://10.0.0.5/'],
    ['https://[::1]/'],
    ['https://[::ffff:127.0.0.1]/'],
    ['https://224.0.0.1/'],
    ['https://[64:ff9b::a00:5]/'],
  ])('refuses %s before connecting', async (url) => {
    let called = false;
    setRequestFnForTests((() => {
      called = true;
      throw new Error('should not connect');
    }) as unknown as Parameters<typeof setRequestFnForTests>[0]);
    await expect(outboundFetch(url)).rejects.toThrow(OutboundFetchError);
    expect(called).toBe(false);
  });

  it('refuses a hostname that resolves to a private address', async () => {
    setResolverForTests(async () => [{ address: '10.1.2.3', family: 4 }]);
    await expect(outboundFetch('https://internal.example.test/')).rejects.toThrow(OutboundFetchError);
  });

  it('refuses a redirect from a public host to a private address', async () => {
    stubPublicHost('public.example.test');
    routeToTestServer();
    server.on('request', (req, res) => {
      res.writeHead(302, { location: 'https://169.254.169.254/meta' });
      res.end();
    });
    await expect(outboundFetch('https://public.example.test/start')).rejects.toThrow(OutboundFetchError);
  });

  it('refuses http:// URLs', async () => {
    await expect(outboundFetch('http://public.example.test/')).rejects.toThrow(OutboundFetchError);
  });

  it('refuses URLs with user info', async () => {
    await expect(outboundFetch('https://user:pass@public.example.test/')).rejects.toThrow(OutboundFetchError);
  });
});

describe('outboundFetch transport limits', () => {
  it('fetches a response from an allowed host', async () => {
    stubPublicHost('public.example.test');
    routeToTestServer();
    server.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hello');
    });
    const result = await outboundFetch('https://public.example.test/ok');
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('text/plain');
    expect(Buffer.from(result.body).toString('utf8')).toBe('hello');
  });

  it('follows a redirect to another allowed host', async () => {
    stubPublicHost('public.example.test', 'public2.example.test');
    routeToTestServer();
    server.on('request', (req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: 'https://public2.example.test/end' });
        res.end();
        return;
      }
      res.writeHead(200, {});
      res.end('final');
    });
    const result = await outboundFetch('https://public.example.test/start');
    expect(Buffer.from(result.body).toString('utf8')).toBe('final');
  });

  it('gives up after too many redirects', async () => {
    stubPublicHost('public.example.test');
    routeToTestServer();
    server.on('request', (req, res) => {
      res.writeHead(302, { location: 'https://public.example.test/next' });
      res.end();
    });
    await expect(outboundFetch('https://public.example.test/start')).rejects.toThrow(OutboundFetchError);
  });

  it('cuts off a response larger than the byte cap', async () => {
    stubPublicHost('public.example.test');
    routeToTestServer();
    server.on('request', (req, res) => {
      res.writeHead(200, {});
      res.end('x'.repeat(1000));
    });
    await expect(outboundFetch('https://public.example.test/big', { maxBytes: 10 })).rejects.toThrow(OutboundFetchError);
  });

  it('times out on a slow server', async () => {
    stubPublicHost('public.example.test');
    routeToTestServer();
    server.on('request', () => {
      // never respond
    });
    await expect(outboundFetch('https://public.example.test/slow', { timeoutMs: 50 })).rejects.toThrow(OutboundFetchError);
  });
});

describe('resolveDidDocument', () => {
  it('resolves did:plc via plc.directory', async () => {
    stubPublicHost('plc.directory');
    routeToTestServer();
    server.on('request', (req, res) => {
      expect(req.url).toBe('/did:plc:alice');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'did:plc:alice', service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example' }] }));
    });
    const doc = await resolveDidDocument('did:plc:alice');
    expect(doc.id).toBe('did:plc:alice');
    expect(doc.service?.[0].serviceEndpoint).toBe('https://pds.example');
  });

  it('resolves did:web via the well-known path', async () => {
    stubPublicHost('alice.example.test');
    routeToTestServer();
    server.on('request', (req, res) => {
      expect(req.url).toBe('/.well-known/did.json');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'did:web:alice.example.test' }));
    });
    const doc = await resolveDidDocument('did:web:alice.example.test');
    expect(doc.id).toBe('did:web:alice.example.test');
  });

  it('never grows the cache past its bound under many distinct DIDs', async () => {
    setResolverForTests(async () => [{ address: PUBLIC_TEST_ADDRESS, family: 4 }]);
    routeToTestServer();
    server.on('request', (req, res) => {
      const did = decodeURIComponent(req.url!.slice(1));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: did }));
    });
    const iterations = 250;
    for (let i = 0; i < iterations; i++) {
      await resolveDidDocument(`did:plc:member${i}`);
    }
    const size = didDocumentCacheSizeForTests();
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(iterations);
  });
});
