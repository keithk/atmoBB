import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { happyViewTransport } from './happyview-transport';
import { resetOutboundForTests, setRequestFnForTests, setResolverForTests, type OutboundRequestFn } from './extensions/outbound';

const options = { instanceUrl: 'http://127.0.0.1:3000', appUrl: 'https://forum.example', clientKey: 'public-client' };
let server: Server | undefined;

afterEach(async () => {
  resetOutboundForTests();
  vi.restoreAllMocks();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('HappyView SDK network boundary', () => {
  it.each([
    'http://public.example/token',
    'https://127.0.0.1/token',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/.well-known/did.json',
    'https://[::ffff:127.0.0.1]/par',
    'https://private.example/resolve',
    'https://private.example/.well-known/did.json',
    'https://private.example/.well-known/oauth-protected-resource',
    'https://private.example/.well-known/oauth-authorization-server',
    'https://private.example/par',
    'https://private.example/token',
  ])('refuses %s before opening a connection', async (url) => {
    const direct = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected direct fetch'));
    const connect = vi.fn(() => { throw new Error('Unexpected socket'); });
    setRequestFnForTests(connect);
    setResolverForTests(async () => [{ address: '10.0.0.20', family: 4 }]);
    await expect(happyViewTransport(options)(url)).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/.well-known/did.json'],
    ['GET', '/.well-known/oauth-protected-resource'],
    ['POST', '/token'],
    ['GET', '/oauth/dpop-keys'],
    ['POST', '/admin/api-clients'],
  ])('does not extend internal-HappyView trust to %s %s', async (method, path) => {
    const fetch = vi.fn();
    await expect(happyViewTransport({ ...options, fetch })(`${options.instanceUrl}${path}`, {
      method, headers: { 'x-client-key': options.clientKey },
    })).rejects.toThrow('unexpected request');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('permits only the intended trusted operation and does not forward browser cookies', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
    await happyViewTransport({ ...options, fetch })(`${options.instanceUrl}/oauth/dpop-keys`, {
      method: 'POST', headers: { 'x-client-key': options.clientKey, cookie: 'browser-secret' },
    });
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.headers.get('origin')).toBe(options.appUrl);
    expect(request.headers.has('cookie')).toBe(false);
    expect(request.redirect).toBe('error');
  });

  it('rejects wrong destinations and credentials before the explicit fake-fetch seam too', async () => {
    const fetch = vi.fn();
    const transport = happyViewTransport({ ...options, fetch });
    await expect(transport('http://attacker.example/token')).rejects.toThrow('HTTPS');
    await expect(transport('https://attacker.example/token', {
      headers: { 'x-client-key': options.clientKey },
    })).rejects.toThrow('forward');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the vetted IP once with original Host/SNI and refuses redirect forwarding', async () => {
    server = createServer((_req, res) => {
      res.writeHead(307, { location: 'https://other.example/token' });
      res.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const resolveHost = vi.fn(async () => [{ address: '203.0.113.10', family: 4 }]);
    setResolverForTests(resolveHost);
    const connect = vi.fn<OutboundRequestFn>((request, callback) => {
      expect(request.host).toBe('203.0.113.10');
      expect(request.servername).toBe('public.example');
      expect(request.headers.host).toBe('public.example');
      expect(request.headers.origin).toBeUndefined();
      return httpRequest({ ...request, host: '127.0.0.1', port }, callback);
    });
    setRequestFnForTests(connect);
    await expect(happyViewTransport(options)('https://public.example/token', {
      method: 'POST', headers: { dpop: 'test-proof' }, body: 'code=synthetic',
    })).rejects.toMatchObject({ code: 'RedirectNotAllowed' });
    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('enforces the OAuth response-byte bound on the production transport', async () => {
    server = createServer((_req, res) => res.end('x'.repeat(1024 * 1024 + 1)));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    setResolverForTests(async () => [{ address: '203.0.113.10', family: 4 }]);
    setRequestFnForTests((request, callback) => httpRequest({ ...request, host: '127.0.0.1', port }, callback));
    await expect(happyViewTransport(options)('https://public.example/did.json')).rejects.toMatchObject({ code: 'ResponseTooLarge' });
  });
});
