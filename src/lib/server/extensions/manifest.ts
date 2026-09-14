import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';
import { env } from '$env/dynamic/private';
import { parseLexiconDoc, type LexiconDoc } from '@atproto/lexicon';
import { NSID, isValidDid } from '@atproto/syntax';
import { CAPABILITIES, HOST_API_VERSION, type ExtensionManifest } from '$lib/extensions/contract';
import authForum from '../../../../lexicons/app/atmobb/authForum.json';
import authSysop from '../../../../lexicons/app/atmobb/authSysop.json';
import { outboundFetch, resolveDidDocument, type DidDocument, type OutboundFetchOptions, type OutboundFetchResult } from './outbound';

// The forum account's session already holds every authSysop collection plus
// the moderation and stamp scopes, so the collections an admin approves here
// are the only thing between an extension and forged staff grants, bans, or
// forum profiles. Admission refuses anything outside that approved set.

/** ATMOBB_EXTENSIONS=off turns every extension off. */
export const extensionsEnabled = () => env.ATMOBB_EXTENSIONS !== 'off';

export const MAX_DECLARED_COLLECTIONS = 16;
/** Characters in the space-separated `repo:<collection>` scope the collections add to the forum login. */
export const MAX_SCOPE_LENGTH = 1024;
export const MAX_LEXICON_FILES = 32;
export const MAX_LEXICON_BYTES = 64 * 1024;
/** How many refs deep a declared record's schema may reach. */
export const MAX_LEXICON_REF_DEPTH = 8;

const MAX_LABEL_LENGTH = 100;
const MAX_PATH_LENGTH = 200;
const LEXICON_FETCH_TIMEOUT_MS = 5_000;

/** Namespaces atmoBB, atproto, Bluesky, Ozone, and atmo.pub own. */
const RESERVED_AUTHORITIES = ['app.atmobb', 'com.atproto', 'app.bsky', 'chat.bsky', 'tools.ozone', 'pub.atmo'];

/** Collection → the permission set that already grants it, lowercased for comparison. */
const forumScopeCollections = new Map<string, string>(
  [authSysop, authForum].flatMap((set) =>
    set.defs.main.permissions
      .filter((permission) => permission.resource === 'repo')
      .flatMap((permission) => permission.collection.map((collection) => [collection.toLowerCase(), set.id] as const)),
  ),
);

export interface FieldError {
  field: string;
  /** Starts with the field name, so it reads on its own. */
  message: string;
}

const fieldError = (field: string, text: string): FieldError => ({ field, message: `${field}: ${text}` });

export type ManifestValidation = { ok: true; manifest: ExtensionManifest } | { ok: false; errors: FieldError[] };

export type Admission =
  | {
      ok: true;
      manifest: ExtensionManifest;
      /** The one NSID authority every declared collection sits under; null when none are declared. */
      authority: string | null;
      collections: string[];
      scope: string;
      /** The shipped lexicon documents, as shipped. */
      lexicons: LexiconDoc[];
    }
  | { ok: false; errors: FieldError[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A repository-relative path with no absolute, parent, or backslash tricks. */
function validRepoPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > MAX_PATH_LENGTH) return false;
  return value.split('/').every((segment) => /^[A-Za-z0-9._-]+$/.test(segment) && segment !== '.' && segment !== '..');
}

const parseVersion = (value: string) => {
  const match = /^(\d+)\.(\d+)$/.exec(value);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
};

/** The manifest's shape and host API version. Collection rules live in admitExtension. */
export function validateManifest(raw: unknown, hostApi: string = HOST_API_VERSION): ManifestValidation {
  if (!isObject(raw)) return { ok: false, errors: [fieldError('manifest', 'must be a JSON object')] };
  const errors: FieldError[] = [];

  for (const field of ['id', 'name', 'version'] as const) {
    const value = raw[field];
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_LABEL_LENGTH) {
      errors.push(fieldError(field, `must be a non-empty string of at most ${MAX_LABEL_LENGTH} characters`));
    }
  }

  const needed = typeof raw.hostApi === 'string' ? parseVersion(raw.hostApi) : null;
  const offered = parseVersion(hostApi)!;
  if (!needed) {
    errors.push(fieldError('hostApi', 'must be a major.minor version, like "1.0"'));
  } else if (needed.major !== offered.major) {
    errors.push(fieldError('hostApi', `this extension needs host API ${raw.hostApi}, but this atmoBB offers ${hostApi}, a different major version`));
  } else if (needed.minor > offered.minor) {
    errors.push(fieldError('hostApi', `this extension needs host API ${raw.hostApi}, but this atmoBB offers ${hostApi}. Update atmoBB to install it.`));
  }

  if (!Number.isInteger(raw.dataVersion) || (raw.dataVersion as number) < 1) {
    errors.push(fieldError('dataVersion', 'must be a whole number, 1 or higher'));
  }

  if (!Array.isArray(raw.collections)) {
    errors.push(fieldError('collections', 'must be a list of NSIDs'));
  } else {
    raw.collections.forEach((collection, i) => {
      if (typeof collection !== 'string') errors.push(fieldError(`collections[${i}]`, 'must be a string'));
    });
  }

  if (!Array.isArray(raw.capabilities)) {
    errors.push(fieldError('capabilities', `must be a list drawn from ${CAPABILITIES.join(', ')}`));
  } else {
    raw.capabilities.forEach((capability, i) => {
      if (!(CAPABILITIES as readonly unknown[]).includes(capability)) {
        errors.push(fieldError(`capabilities[${i}]`, `unknown capability ${JSON.stringify(capability)}; expected one of ${CAPABILITIES.join(', ')}`));
      }
    });
  }

  if (raw.ui !== undefined && !(isObject(raw.ui) && validRepoPath(raw.ui.entry))) {
    errors.push(fieldError('ui.entry', 'must be a path inside the repository, like "ui/index.html"'));
  }

  if (!Array.isArray(raw.lexicons)) {
    errors.push(fieldError('lexicons', 'must be a list of paths to lexicon files'));
  } else if (raw.lexicons.length > MAX_LEXICON_FILES) {
    errors.push(fieldError('lexicons', `lists ${raw.lexicons.length} files; the limit is ${MAX_LEXICON_FILES}`));
  } else {
    raw.lexicons.forEach((path, i) => {
      if (!validRepoPath(path)) errors.push(fieldError(`lexicons[${i}]`, 'must be a path inside the repository, like "lexicons/game.json"'));
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, manifest: raw as unknown as ExtensionManifest };
}

/** The OAuth scope text the declared collections add. */
export const collectionScope = (collections: string[]) => collections.map((c) => `repo:${c}`).join(' ');

/** The NSID minus its final segment. */
const nsidAuthority = (nsid: string) => nsid.split('.').slice(0, -1).join('.');

/**
 * Why extensions may never write `collection` (a forum-scope collection or a
 * reserved namespace), or null when nothing reserves it. Checked at install
 * and again before every write.
 */
export function reservedReason(collection: string): string | null {
  const lower = collection.toLowerCase();
  const set = forumScopeCollections.get(lower);
  if (set) return `${collection} is already granted to the forum account by ${set}`;
  const authority = RESERVED_AUTHORITIES.find((prefix) => lower.startsWith(`${prefix}.`));
  return authority ? `${collection} is under ${authority}.*, which extensions can't write to` : null;
}

function lexiconError(error: unknown): string {
  const issue = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues?.[0];
  if (issue) return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
  return error instanceof Error ? error.message : String(error);
}

/** Every ref and union member written anywhere inside a definition. */
function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (!isObject(value)) return [];
  const own =
    value.type === 'ref' && typeof value.ref === 'string'
      ? [value.ref]
      : value.type === 'union' && Array.isArray(value.refs)
        ? value.refs.filter((ref): ref is string => typeof ref === 'string')
        : [];
  return [...own, ...Object.values(value).flatMap(refsIn)];
}

class RefProblem extends Error {}

/** Throws a RefProblem when a ref from `start` dangles, loops, or runs past the depth cap. */
function checkRefs(docs: Map<string, LexiconDoc>, start: string) {
  const depthBelow = new Map<string, number>();
  const inProgress = new Set<string>();
  const tooDeep = () => new RefProblem(`refs run more than ${MAX_LEXICON_REF_DEPTH} deep`);

  const visit = (key: string, level: number): number => {
    if (level > MAX_LEXICON_REF_DEPTH) throw tooDeep();
    const known = depthBelow.get(key);
    if (known !== undefined) {
      if (level + known > MAX_LEXICON_REF_DEPTH) throw tooDeep();
      return known;
    }
    if (inProgress.has(key)) throw new RefProblem(`${key} refers back to itself`);
    const [id, name] = key.split('#');
    const def = (docs.get(id)?.defs as Record<string, unknown> | undefined)?.[name];
    if (!def) throw new RefProblem(`ref ${key} does not resolve to a shipped lexicon`);

    inProgress.add(key);
    let depth = 0;
    for (const ref of refsIn(def)) {
      const child = ref.startsWith('#') ? `${id}${ref}` : ref.includes('#') ? ref : `${ref}#main`;
      depth = Math.max(depth, 1 + visit(child, level + 1));
    }
    inProgress.delete(key);
    depthBelow.set(key, depth);
    return depth;
  };

  visit(`${start}#main`, 0);
}

/**
 * Whether an extension may be installed: a valid manifest, lexicon files that
 * parse and stay within the caps, and declared collections that each have a
 * shipped record lexicon, sit outside every reserved namespace and forum
 * scope, and share one NSID authority. `lexiconFiles` maps each path in
 * `manifest.lexicons` to the file's text.
 */
export function admitExtension(raw: unknown, lexiconFiles: Record<string, string>, hostApi: string = HOST_API_VERSION): Admission {
  const validated = validateManifest(raw, hostApi);
  if (!validated.ok) return validated;
  const { manifest } = validated;
  const errors: FieldError[] = [];

  const docs = new Map<string, LexiconDoc>();
  manifest.lexicons.forEach((path, i) => {
    const field = `lexicons[${i}]`;
    const text = Object.hasOwn(lexiconFiles, path) ? lexiconFiles[path] : undefined;
    if (text === undefined) return errors.push(fieldError(field, `${path} is not in the repository`));
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_LEXICON_BYTES) {
      return errors.push(fieldError(field, `${path} is ${bytes} bytes; the limit is ${MAX_LEXICON_BYTES} bytes`));
    }
    let doc: LexiconDoc;
    try {
      doc = JSON.parse(text);
      parseLexiconDoc(doc);
    } catch (error) {
      return errors.push(fieldError(field, `${path} is not a valid lexicon: ${lexiconError(error)}`));
    }
    if (docs.has(doc.id)) return errors.push(fieldError(field, `${path} defines ${doc.id}, which another lexicon file already defines`));
    docs.set(doc.id, doc);
  });

  const { collections } = manifest;
  const scope = collectionScope(collections);
  if (collections.length > MAX_DECLARED_COLLECTIONS) {
    errors.push(fieldError('collections', `declares ${collections.length} collections; the limit is ${MAX_DECLARED_COLLECTIONS}`));
  }
  if (scope.length > MAX_SCOPE_LENGTH) {
    errors.push(fieldError('collections', `the scope these collections add is ${scope.length} characters; the limit is ${MAX_SCOPE_LENGTH}`));
  }

  const authorities = new Set<string>();
  const seen = new Set<string>();
  collections.forEach((collection, i) => {
    const field = `collections[${i}]`;
    if (seen.has(collection)) return errors.push(fieldError(field, `${collection} is declared more than once`));
    seen.add(collection);
    try {
      NSID.parse(collection);
    } catch (error) {
      return errors.push(fieldError(field, `${JSON.stringify(collection)} is not a valid NSID: ${lexiconError(error)}`));
    }
    const authority = nsidAuthority(collection);
    if (authority !== authority.toLowerCase()) {
      return errors.push(fieldError(field, `${collection}: the domain part of an NSID must be lowercase`));
    }
    const reserved = reservedReason(collection);
    if (reserved) return errors.push(fieldError(field, reserved));
    const doc = docs.get(collection);
    if (!doc) return errors.push(fieldError(field, `${collection} has no lexicon among the shipped lexicon files`));
    if (doc.defs.main?.type !== 'record') {
      return errors.push(fieldError(field, `${collection}'s lexicon must define a record as its main definition`));
    }
    try {
      checkRefs(docs, collection);
    } catch (error) {
      if (!(error instanceof RefProblem)) throw error;
      return errors.push(fieldError(field, `${collection}: ${error.message}`));
    }
    authorities.add(authority);
  });
  if (authorities.size > 1) {
    errors.push(fieldError('collections', `every collection must share one NSID authority; these span ${[...authorities].join(', ')}`));
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest, authority: [...authorities][0] ?? null, collections, scope, lexicons: [...docs.values()] };
}

// --- Published lexicons ------------------------------------------------------
//
// An authority can publish its lexicons: a `_lexicon.<authority as a domain>`
// TXT record names a DID, and that DID's repo holds
// com.atproto.lexicon.schema records keyed by NSID. An extension shipping a
// schema that differs from the published one is refused. Nothing published is
// not a refusal; the install review says so instead.

export interface LexiconResolver {
  /** The DID the authority's `_lexicon` TXT record names, or null when there is none. */
  authorityDid(authority: string): Promise<string | null>;
  /** The published schema record's value, or null when the repo has none for this NSID. */
  publishedSchema(did: string, nsid: string): Promise<unknown | null>;
}

export type PublishedLexiconCheck =
  | { status: 'verified'; did: string }
  | { status: 'unpublished'; did?: string; missing: string[]; warning?: string }
  | { status: 'refused'; did: string; differing: string[]; error: string };

export interface LexiconResolverDeps {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveDidDocument(did: string): Promise<DidDocument>;
  fetch(url: string, opts: OutboundFetchOptions): Promise<OutboundFetchResult>;
}

const networkDeps: LexiconResolverDeps = { resolveTxt: dnsResolveTxt, resolveDidDocument, fetch: outboundFetch };

export function lexiconResolver(deps: LexiconResolverDeps = networkDeps): LexiconResolver {
  return {
    async authorityDid(authority) {
      const hostname = `_lexicon.${authority.split('.').reverse().join('.')}`;
      let records: string[][];
      try {
        records = await deps.resolveTxt(hostname);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOTFOUND' || code === 'ENODATA') return null;
        throw error;
      }
      const dids = [...new Set(records.map((chunks) => chunks.join('')).filter((text) => text.startsWith('did=')).map((text) => text.slice(4)))];
      if (!dids.length) return null;
      if (dids.length > 1) throw new Error(`${hostname} names more than one DID`);
      if (!isValidDid(dids[0])) throw new Error(`${hostname} names an invalid DID`);
      return dids[0];
    },

    async publishedSchema(did, nsid) {
      const doc = await deps.resolveDidDocument(did);
      const pds = doc.service?.find(
        (service) => service.type === 'AtprotoPersonalDataServer' && (service.id === '#atproto_pds' || service.id === `${did}#atproto_pds`),
      )?.serviceEndpoint;
      if (!pds) throw new Error(`${did} lists no PDS`);
      const query = new URLSearchParams({ repo: did, collection: 'com.atproto.lexicon.schema', rkey: nsid });
      const url = `${pds.replace(/\/+$/, '')}/xrpc/com.atproto.repo.getRecord?${query}`;
      const res = await deps.fetch(url, { maxBytes: 2 * MAX_LEXICON_BYTES, timeoutMs: LEXICON_FETCH_TIMEOUT_MS });
      const body = (() => {
        try {
          return JSON.parse(new TextDecoder().decode(res.body));
        } catch {
          return null;
        }
      })();
      if (res.status === 200 && isObject(body)) return body.value ?? null;
      if (res.status === 400 && body?.error === 'RecordNotFound') return null;
      throw new Error(`${pds} returned ${res.status} for the ${nsid} schema`);
    },
  };
}

/** JSON with object keys sorted at every level, so key order never counts as a difference. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Compare the shipped lexicons under `authority` with what that authority publishes. */
export async function checkPublishedLexicons(
  authority: string,
  lexicons: LexiconDoc[],
  resolver: LexiconResolver = lexiconResolver(),
): Promise<PublishedLexiconCheck> {
  const shipped = lexicons.filter((doc) => nsidAuthority(doc.id) === authority);
  const nsids = shipped.map((doc) => doc.id);
  try {
    const did = await resolver.authorityDid(authority);
    if (!did) return { status: 'unpublished', missing: nsids };
    const missing: string[] = [];
    const differing: string[] = [];
    for (const doc of shipped) {
      const published = await resolver.publishedSchema(did, doc.id);
      if (published === null) {
        missing.push(doc.id);
        continue;
      }
      const { $type: _type, ...schema } = isObject(published) ? published : { $type: undefined };
      if (canonicalJson(schema) !== canonicalJson(doc)) differing.push(doc.id);
    }
    if (differing.length) {
      return { status: 'refused', did, differing, error: `The shipped lexicon for ${differing.join(', ')} differs from the one ${authority} publishes` };
    }
    return missing.length ? { status: 'unpublished', did, missing } : { status: 'verified', did };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: 'unpublished', missing: nsids, warning: `Couldn't check the lexicons ${authority} publishes: ${reason}` };
  }
}
