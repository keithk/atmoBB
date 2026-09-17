import { lookup as dnsLookup } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequestImpl } from 'node:https';
import { BlockList, isIP } from 'node:net';

// The one fetcher the extension system is allowed to reach the outside world
// through: git fetches (admin-supplied URLs) and PDS reads (`pdsFor` trusts
// whatever service endpoint a DID document lists). Either could point at
// Happyview on :8015, the cloud metadata address, or anything else on the
// shard's own network, so every request — including each redirect hop —
// is re-checked against the same address blocklist before it connects.
//
// file:// is not supported here; local sources never go through this fetcher.

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

const DID_DOC_MAX_BYTES = 64 * 1024;
const DID_DOC_TIMEOUT_MS = 5_000;
const DID_CACHE_MAX = 200;
const DID_CACHE_TTL_MS = 5 * 60_000;

export class OutboundFetchError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OutboundFetchError';
  }
}

// Loopback, RFC1918 private, link-local, CGNAT, multicast, reserved (IPv4) and
// loopback, link-local, unique-local, multicast, NAT64 (IPv6). node:net's BlockList also treats an
// IPv4-mapped IPv6 address (::ffff:127.0.0.1) as its embedded IPv4 form when
// checked against an ipv4 subnet, so mapped addresses need no special case.
const blockedAddresses = new BlockList();
blockedAddresses.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
blockedAddresses.addSubnet('10.0.0.0', 8, 'ipv4'); // private
blockedAddresses.addSubnet('172.16.0.0', 12, 'ipv4'); // private
blockedAddresses.addSubnet('192.168.0.0', 16, 'ipv4'); // private
blockedAddresses.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local
blockedAddresses.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
blockedAddresses.addAddress('0.0.0.0', 'ipv4'); // unspecified
blockedAddresses.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
blockedAddresses.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved, broadcast
blockedAddresses.addSubnet('::1', 128, 'ipv6'); // loopback
blockedAddresses.addSubnet('fe80::', 10, 'ipv6'); // link-local
blockedAddresses.addSubnet('fc00::', 7, 'ipv6'); // unique-local
blockedAddresses.addAddress('::', 'ipv6'); // unspecified
blockedAddresses.addSubnet('ff00::', 8, 'ipv6'); // multicast
blockedAddresses.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64, which can reach private IPv4

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return true; // not a real address — refuse rather than guess
  return blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

// --- DNS resolution (a test seam stubs this; production hits real DNS) -----

type Resolved = { address: string; family: number };

async function defaultResolveHost(hostname: string): Promise<Resolved[]> {
  return dnsLookup(hostname, { all: true });
}

let resolveHost: (hostname: string) => Promise<Resolved[]> = defaultResolveHost;

/** Test-only: stub DNS resolution. Pass null to restore the real resolver. */
export function setResolverForTests(fn: ((hostname: string) => Promise<Resolved[]>) | null) {
  resolveHost = fn ?? defaultResolveHost;
}

// --- transport (a test seam swaps this for a local http server) ------------

export interface OutboundRequestOptions {
  host: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  servername?: string;
  signal?: AbortSignal;
}

export type OutboundRequestFn = (
  options: OutboundRequestOptions,
  callback: (res: IncomingMessage) => void,
) => ClientRequest;

// Cast: node:https's `request` has a richer options type than the small
// shape above, but every field we set is one it accepts.
let requestFn: OutboundRequestFn = httpsRequestImpl as unknown as OutboundRequestFn;

/**
 * Test-only: replace the function that opens the actual connection. A local
 * HTTPS server with a self-signed cert is awkward to stand up in tests, so
 * tests swap this for a wrapper around node:http's `request` that dials a
 * local plain-HTTP server instead. Production never touches this — it always
 * goes through node:https, so a real deployment refuses non-HTTPS regardless
 * of what a test does here. Pass null to restore the real transport.
 */
export function setRequestFnForTests(fn: OutboundRequestFn | null) {
  requestFn = fn ?? (httpsRequestImpl as unknown as OutboundRequestFn);
}

export function resetOutboundForTests() {
  resolveHost = defaultResolveHost;
  requestFn = httpsRequestImpl as unknown as OutboundRequestFn;
  didDocumentCache.clear();
}

// --- URL + address vetting --------------------------------------------------

function parseAndValidateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundFetchError('InvalidUrl', `Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    throw new OutboundFetchError('NotHttps', `Refused non-HTTPS URL: ${raw}`);
  }
  if (url.username || url.password) {
    throw new OutboundFetchError('UserInfoNotAllowed', `Refused URL with user info: ${raw}`);
  }
  return url;
}

// Resolves (or accepts a literal IP), rejects a disallowed address, and
// returns the address to connect to — pinned for this request so a second
// DNS answer later (rebinding) can't swap in something else.
async function resolveVettedAddress(hostname: string): Promise<string> {
  // URL.hostname keeps the brackets around an IPv6 literal (e.g. "[::1]");
  // isIP and DNS resolution both want the bare address.
  const bare = hostname.replace(/^\[(.*)\]$/, '$1');
  const literalFamily = isIP(bare);
  const candidates: Resolved[] = literalFamily
    ? [{ address: bare, family: literalFamily }]
    : await resolveHost(bare);
  const first = candidates[0];
  if (!first) throw new OutboundFetchError('UnresolvableHost', `Could not resolve ${hostname}`);
  if (isBlockedAddress(first.address)) {
    throw new OutboundFetchError('BlockedAddress', `Refused to connect to ${first.address} (resolved from ${hostname})`);
  }
  return first.address;
}

// --- fetching ----------------------------------------------------------------

export interface OutboundFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface OutboundFetchResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

function flattenHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

type RequestOutcome = { redirectTo: string } | OutboundFetchResult;

function performRequest(
  url: URL,
  address: string,
  opts: OutboundFetchOptions,
  maxBytes: number,
  timeoutMs: number,
): Promise<RequestOutcome> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (value: RequestOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const options: OutboundRequestOptions = {
      host: address,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: opts.method ?? 'GET',
      headers: { host: url.host, ...opts.headers },
      servername: url.hostname.replace(/^\[(.*)\]$/, '$1'), // TLS SNI + cert check target the real hostname, not the pinned IP
      signal: controller.signal,
    };

    const req = requestFn(options, (res) => {
      const status = res.statusCode ?? 0;
      const headers = flattenHeaders(res.headers);
      if (status >= 300 && status < 400 && headers.location) {
        res.resume(); // discard the redirect body, we're not returning it
        settleResolve({ redirectTo: headers.location });
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          res.destroy();
          req.destroy();
          settleReject(new OutboundFetchError('ResponseTooLarge', `Response exceeded ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => settleResolve({ status, headers, body: Buffer.concat(chunks) }));
      res.on('error', (err) => settleReject(new OutboundFetchError('ResponseError', err.message)));
    });

    req.on('error', (err) => {
      if (controller.signal.aborted) {
        settleReject(new OutboundFetchError('Timeout', `Timed out after ${timeoutMs}ms`));
      } else {
        settleReject(new OutboundFetchError('RequestError', err.message));
      }
    });

    if (opts.body !== undefined) req.end(opts.body);
    else req.end();
  });
}

/** Fetch a URL through the hardened path: HTTPS only, no user info, every hop's address vetted. */
export async function outboundFetch(inputUrl: string, opts: OutboundFetchOptions = {}): Promise<OutboundFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current = inputUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const url = parseAndValidateUrl(current);
    const address = await resolveVettedAddress(url.hostname);
    const outcome = await performRequest(url, address, opts, maxBytes, timeoutMs);
    if ('redirectTo' in outcome) {
      if (redirect === MAX_REDIRECTS) {
        throw new OutboundFetchError('TooManyRedirects', `Exceeded ${MAX_REDIRECTS} redirects fetching ${inputUrl}`);
      }
      current = new URL(outcome.redirectTo, url).toString();
      continue;
    }
    return outcome;
  }
  throw new OutboundFetchError('TooManyRedirects', `Exceeded ${MAX_REDIRECTS} redirects fetching ${inputUrl}`);
}

// --- DID document resolution (bounded LRU cache, TTL) -----------------------

export interface DidDocument {
  id: string;
  alsoKnownAs?: string[];
  service?: { id?: string; type?: string; serviceEndpoint?: string }[];
}

/**
 * The endpoint of the PDS service a DID document lists for `did`, exactly as
 * the document gives it (unchecked, trailing slashes kept), or undefined when
 * it lists none.
 */
export function pdsServiceEndpoint(doc: DidDocument, did: string): string | undefined {
  return doc.service?.find(
    (service) => service.type === 'AtprotoPersonalDataServer' && (service.id === '#atproto_pds' || service.id === `${did}#atproto_pds`),
  )?.serviceEndpoint;
}

const didDocumentCache = new Map<string, { doc: DidDocument; at: number }>();

function cacheGet(did: string): DidDocument | undefined {
  const hit = didDocumentCache.get(did);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= DID_CACHE_TTL_MS) {
    didDocumentCache.delete(did);
    return undefined;
  }
  // Re-insert so the Map's iteration order (oldest first) tracks recency.
  didDocumentCache.delete(did);
  didDocumentCache.set(did, hit);
  return hit.doc;
}

function cacheSet(did: string, doc: DidDocument) {
  didDocumentCache.delete(did);
  didDocumentCache.set(did, { doc, at: Date.now() });
  while (didDocumentCache.size > DID_CACHE_MAX) {
    const oldest = didDocumentCache.keys().next().value;
    if (oldest === undefined) break;
    didDocumentCache.delete(oldest);
  }
}

/** Test-only: the DID document cache's current entry count. */
export function didDocumentCacheSizeForTests(): number {
  return didDocumentCache.size;
}

function didWebUrl(did: string): string {
  // did:web spec: colons after the host become path segments; no extra
  // segments means the well-known path.
  const parts = did.slice('did:web:'.length).split(':').map(decodeURIComponent);
  const host = parts[0];
  const path = parts.slice(1);
  return path.length ? `https://${host}/${path.join('/')}/did.json` : `https://${host}/.well-known/did.json`;
}

/** Resolve a DID document (did:plc via plc.directory, did:web via /.well-known/did.json), cached briefly. */
export async function resolveDidDocument(did: string): Promise<DidDocument> {
  const cached = cacheGet(did);
  if (cached) return cached;

  let url: string;
  if (did.startsWith('did:plc:')) {
    url = `https://plc.directory/${did}`;
  } else if (did.startsWith('did:web:')) {
    url = didWebUrl(did);
  } else {
    throw new OutboundFetchError('UnsupportedDidMethod', `Unsupported DID method: ${did}`);
  }

  const res = await outboundFetch(url, { maxBytes: DID_DOC_MAX_BYTES, timeoutMs: DID_DOC_TIMEOUT_MS });
  if (res.status !== 200) {
    throw new OutboundFetchError('DidDocumentFetchFailed', `${did} document fetch returned ${res.status}`);
  }
  const doc = JSON.parse(new TextDecoder().decode(res.body)) as DidDocument;
  cacheSet(did, doc);
  return doc;
}
