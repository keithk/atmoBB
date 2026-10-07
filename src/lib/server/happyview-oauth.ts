import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Cookies } from '@sveltejs/kit';
import { HappyViewNodeClient } from '@happyview/oauth-client-node';
import { importJwk, LAST_ACTIVE_KEY, STORAGE_PREFIX, type RegisterSessionParams, type StorageAdapter, type StoredSession } from '@happyview/oauth-client';
import { HappyViewStorage } from './happyview-storage';
import { happyViewTransport } from './happyview-transport';

export type OAuthPurpose = 'member' | 'forum';
export type OAuthContext = { purpose: 'member'; next?: string } | {
  purpose: 'forum'; connector: string; forumDid: string;
};
export const FLOW_COOKIE = 'atmobb_hv_oauth';
export const FLOW_TTL = 10 * 60 * 1000;
/** Safe operator-facing configuration failure; SDK/network error bodies are not safe to reflect. */
export class OAuthConfigurationError extends Error {}
const opaque = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

interface Transaction {
  expiresAt: number;
  browser: string;
  configuration: string;
  context: OAuthContext;
  scope: string;
  did: string;
  pds: string;
  issuer: string;
  tokenEndpoint: string;
  parEndpoint?: string;
  jwk?: JsonWebKey;
  sdk: Record<string, string>;
}

interface Options {
  instanceUrl: string;
  appUrl: string;
  clientId: string;
  clientKey: string;
  redirectUri: string;
  dataDir: string;
  forumDid: () => string;
  fetch?: typeof globalThis.fetch;
}

function httpsUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('OAuth discovery returned a missing URL.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('OAuth discovery requires HTTPS URLs without credentials or fragments.');
  }
  return value;
}

/**
 * Adapter around public SDK APIs, not a second OAuth implementation. The SDK owns
 * discovery, PKCE, token exchange, registration and session DPoP. We own browser
 * transactions, identity checks, persistence, and its missing PAR nonce retry.
 */
export class SecureHappyViewOAuth {
  private readonly pending: HappyViewStorage;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: Options) {
    this.pending = new HappyViewStorage(join(options.dataDir, 'happyview-oauth-v1', 'transactions'));
    this.request = happyViewTransport(options);
  }

  private credentials(purpose: OAuthPurpose) {
    return new HappyViewStorage(join(this.options.dataDir, 'happyview-oauth-v1', purpose));
  }

  private configuration() {
    const { instanceUrl, clientId, clientKey, redirectUri } = this.options;
    return hash(JSON.stringify({ instanceUrl, clientId, clientKey, redirectUri }));
  }

  private client(purpose: OAuthPurpose, transaction?: Transaction) {
    const credentials = this.credentials(purpose);
    let registeredScopes: string | undefined;
    // Public session-key constants route durable SDK sessions. Every other opaque
    // SDK key belongs to this one transaction; we never parse SDK pending fields.
    const durable = (key: string) => key.startsWith(STORAGE_PREFIX) || key === LAST_ACTIVE_KEY;
    const storage: StorageAdapter = transaction ? {
      get: async (key) => durable(key) ? credentials.get(key) : transaction.sdk[key] ?? null,
      set: async (key, value) => {
        if (durable(key)) {
          if (key.startsWith(STORAGE_PREFIX) && registeredScopes !== undefined) {
            // StoredSession is a public SDK format. HappyView may narrow or expand
            // the PDS response; report the grant actually registered there.
            const session: StoredSession = JSON.parse(value);
            value = JSON.stringify({ ...session, scopes: registeredScopes });
          }
          await credentials.set(key, value);
        } else transaction.sdk[key] = value;
      },
      delete: async (key) => {
        if (durable(key)) await credentials.delete(key);
        else delete transaction.sdk[key];
      },
    } : credentials;

    let discoveredIssuer: string | undefined;
    let tokenValidated = false;
    const transport: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = request.url;
      const response = await this.request(request.clone());
      if (!transaction) return response;
      if (response.ok && url === `${transaction.pds.replace(/\/+$/, '')}/.well-known/oauth-protected-resource`) {
        const resource = await response.clone().json();
        if (httpsUrl(resource.resource).replace(/\/+$/, '') !== transaction.pds) throw new Error('OAuth resource does not match the account PDS.');
        discoveredIssuer = httpsUrl(resource.authorization_servers?.[0]);
      } else if (response.ok && discoveredIssuer && url === `${discoveredIssuer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`) {
        const metadata = await response.clone().json();
        if (metadata.issuer !== discoveredIssuer) throw new Error('OAuth discovery issuer mismatch.');
        transaction.issuer = discoveredIssuer;
        transaction.tokenEndpoint = httpsUrl(metadata.token_endpoint);
        httpsUrl(metadata.authorization_endpoint);
        transaction.parEndpoint = metadata.pushed_authorization_request_endpoint
          ? httpsUrl(metadata.pushed_authorization_request_endpoint) : undefined;
      } else if (url === transaction.parEndpoint && request.method === 'POST' && !response.ok) {
        const nonce = response.headers.get('dpop-nonce');
        const body = await response.clone().json().catch(() => null);
        if (nonce && body?.error === 'use_dpop_nonce' && transaction.jwk) {
          const key = await importJwk(transaction.jwk);
          const proof = await key.createJwt(
            { alg: 'ES256', typ: 'dpop+jwt', jwk: key.publicJwk },
            { htm: 'POST', htu: url.split('?')[0], iat: Math.floor(Date.now() / 1000), jti: opaque(), nonce },
          );
          request.headers.set('dpop', proof);
          // Exactly one retry, at exactly this transaction's PAR endpoint.
          return this.request(request);
        }
      } else if (url === transaction.tokenEndpoint && request.method === 'POST' && response.ok) {
        const token = await response.clone().json();
        if (token.sub !== transaction.did || (token.iss !== undefined && token.iss !== transaction.issuer)) {
          throw new Error('OAuth token identity does not match the initiating account.');
        }
        if (typeof token.access_token !== 'string' || !token.access_token || token.token_type?.toLowerCase() !== 'dpop'
          || (token.scope !== undefined && typeof token.scope !== 'string')) {
          throw new Error('OAuth server returned an invalid DPoP token response.');
        }
        tokenValidated = true;
      } else if (url === `${this.options.instanceUrl}/oauth/sessions` && request.method === 'POST' && response.ok) {
        const registration = await response.clone().json();
        if (registration.did !== transaction.did) throw new Error('HappyView registered a different account.');
        if (registration.scopes !== undefined) {
          if (!Array.isArray(registration.scopes)
            || !registration.scopes.every((scope: unknown) => typeof scope === 'string' && scope.length > 0 && !/\s/.test(scope))) {
            throw new Error('HappyView returned invalid registered scopes.');
          }
          registeredScopes = registration.scopes.join(' ');
        }
      }
      return response;
    };
    const sdk = new class extends HappyViewNodeClient {
      override async provisionDpopKey() {
        const provision = await super.provisionDpopKey();
        if (transaction) transaction.jwk = provision.rawJwk;
        return provision;
      }
      override async registerSession(params: RegisterSessionParams) {
        if (!transaction || !tokenValidated || params.did !== transaction.did
          || params.issuer !== transaction.issuer || params.pdsUrl !== transaction.pds) {
          throw new Error('OAuth account identity was not verified before registration.');
        }
        await super.registerSession(params);
        // Return the same scope that the adapter saved, including any server-side
        // narrowing. restore is public; no SDK private session fields are read.
        return this.restore(params.did);
      }
    }({
      instanceUrl: this.options.instanceUrl, clientKey: this.options.clientKey,
      clientId: this.options.clientId, redirectUri: this.options.redirectUri,
      // Omitted token scope must mean this request, never metadata's union.
      scopes: transaction?.scope ?? 'atproto', storage, fetch: transport,
    });
    return sdk;
  }

  async authorize(handle: string, options: { scope: string; cookies: Cookies; context: OAuthContext }): Promise<URL> {
    handle = handle.toLowerCase();
    this.pending.prune(Date.now() - FLOW_TTL);
    const state = opaque();
    const browser = opaque();
    const transaction: Transaction = {
      expiresAt: Date.now() + FLOW_TTL, browser: hash(browser), configuration: this.configuration(), context: options.context,
      scope: options.scope, did: '', pds: '', issuer: '', tokenEndpoint: '', sdk: {},
    };
    const client = this.client(options.context.purpose, transaction);
    const did = await client.handleResolver.resolve(handle);
    if (!did) throw new Error('Could not resolve this handle.');
    const doc = await client.didResolver.resolve(did);
    if (doc.id !== did || !doc.alsoKnownAs?.includes(`at://${handle}`)) {
      throw new Error('The account DID does not confirm this handle.');
    }
    if (options.context.purpose === 'forum' && did !== options.context.forumDid) {
      throw new Error('Enter the configured forum account, not your personal account.');
    }
    transaction.did = did;
    const services = doc.service?.filter((service) => service.id === '#atproto_pds' || service.id === `${did}#atproto_pds`) ?? [];
    const pds = services[0];
    if (services.length !== 1 || pds.type !== 'AtprotoPersonalDataServer') throw new Error('The account must declare exactly one AT Protocol PDS service.');
    transaction.pds = httpsUrl(pds?.serviceEndpoint).replace(/\/+$/, '');
    // The SDK resolves again and accepts any service ID ending in #atproto_pds.
    // Pin its public resolvers to this verified identity and only this service.
    // This also keeps the SDK's persisted pdsUrl normalized exactly like ours.
    client.handleResolver.resolve = async (requestedHandle) => {
      if (requestedHandle !== handle) throw new Error('OAuth handle changed during authorization.');
      return did;
    };
    const resolvePinnedDid = async (requestedDid: string) => {
      if (requestedDid !== did) throw new Error('OAuth DID changed during authorization.');
      return { ...doc, service: [{ ...pds, serviceEndpoint: transaction.pds }] };
    };
    // The runtime equality guard preserves the resolver's generic DID→document
    // relationship, which TypeScript cannot infer across the captured DID.
    client.didResolver.resolve = resolvePinnedDid as typeof client.didResolver.resolve;
    const url = await client.authorize(handle, { state, scope: options.scope });
    if (!transaction.issuer || !transaction.tokenEndpoint) throw new Error('OAuth discovery was not verified.');
    delete transaction.jwk; // The PAR-only copy is no longer needed.
    await this.pending.set(state, JSON.stringify(transaction));
    options.cookies.set(FLOW_COOKIE, browser, {
      path: '/oauth/callback', httpOnly: true, sameSite: 'lax',
      secure: this.options.appUrl.startsWith('https:'), maxAge: FLOW_TTL / 1000,
    });
    return url;
  }

  async callback(params: URLSearchParams, cookies: Cookies, personalDid: string | null) {
    for (const name of ['state', 'iss', 'code', 'error']) {
      if (params.getAll(name).length > 1) throw new Error('Duplicate OAuth callback parameter.');
    }
    const state = params.get('state');
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('Invalid OAuth transaction.');
    const raw = await this.pending.get(state);
    if (!raw) throw new Error('OAuth transaction expired or already used. Start again.');
    const browser = cookies.get(FLOW_COOKIE);
    const check = (tx: Transaction) => {
      if (tx.expiresAt <= Date.now()) throw new Error('OAuth transaction expired. Start again.');
      if (!browser || hash(browser) !== tx.browser) throw new Error('OAuth callback belongs to another browser.');
      if (tx.configuration !== this.configuration()) throw new Error('OAuth configuration changed. Start again.');
      if (tx.context.purpose === 'forum'
        && (personalDid !== tx.context.connector || this.options.forumDid() !== tx.context.forumDid || tx.did !== tx.context.forumDid)) {
        throw new Error('Forum connection no longer belongs to the initiating user or forum.');
      }
    };
    check(JSON.parse(raw));
    const claimed = await this.pending.take(state);
    if (!claimed) throw new Error('OAuth transaction already used. Start again.');
    cookies.delete(FLOW_COOKIE, { path: '/oauth/callback' });
    const transaction: Transaction = JSON.parse(claimed);
    check(transaction);
    if (params.get('iss') !== transaction.issuer) throw new Error('OAuth callback issuer mismatch.');
    const { session } = await this.client(transaction.context.purpose, transaction).callback(params);
    return { session, context: transaction.context };
  }

  restore(did: string, _refresh?: boolean, purpose: OAuthPurpose = 'member') {
    return this.client(purpose).restore(did);
  }

  revoke(did: string, purpose: OAuthPurpose = 'member') {
    return this.client(purpose).revoke(did);
  }

  /** Supported server-side as-DID transport. No arbitrary URL credential forwarding. */
  async fetch(did: string, path: string, init: RequestInit = {}, purpose?: OAuthPurpose) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
      throw new Error('HappyView requests require an absolute path, not an external URL.');
    }
    const session = await this.restore(did, false, purpose);
    return session.fetchHandler(path, init);
  }
}
