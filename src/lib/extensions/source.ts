import { isObject } from './contract';

// Where a standalone page's records come from. A panel names the source DID
// with an `atmobb:source` message; the page asks its install's source endpoint
// who that DID is and draws the answer outside the frame, since a panel could
// claim anything inside it. Shared by the endpoint and the panel component, so
// nothing here may import browser- or server-only code.

/** What the source endpoint answers for a DID. */
export interface SourceIdentity {
  did: string;
  /** The handle the DID document claims, or null when it names no valid one. */
  handle: string | null;
  /** Whether that handle resolves back to this DID. */
  handleVerified: boolean;
  /** Whether the DID's repo holds an atmoBB forum profile. */
  forum: boolean;
  /** The forum profile's name, for a forum. */
  forumName?: string;
  /** Set when the DID document or the repo couldn't be read, so `forum` is a fallback rather than an answer. */
  unavailable?: true;
}

export type SourceState = { status: 'checking'; did: string } | { status: 'checked'; identity: SourceIdentity };

export const unresolvedSource = (did: string): SourceIdentity => ({ did, handle: null, handleVerified: false, forum: false, unavailable: true });

/** The endpoint's answer about `did`, or an unresolved source for a refusal or anything malformed. */
export function sourceFromResponse(did: string, status: number, body: unknown): SourceIdentity {
  if (status !== 200 || !isObject(body) || body.did !== did) return unresolvedSource(did);
  const { handle, handleVerified, forum, forumName, unavailable } = body;
  if (!(handle === null || typeof handle === 'string') || typeof handleVerified !== 'boolean' || typeof forum !== 'boolean') return unresolvedSource(did);
  return {
    did,
    handle,
    handleVerified,
    forum,
    ...(typeof forumName === 'string' ? { forumName } : {}),
    ...(unavailable === true ? { unavailable: true as const } : {}),
  };
}

export interface SourceLine {
  /** `@handle` when the handle is verified, otherwise the DID. */
  name: string;
  did: string;
  forum: boolean;
  forumName?: string;
  /** False when the forum check couldn't run. */
  checked: boolean;
}

/** How the page labels a source. */
export function sourceLine(identity: SourceIdentity): SourceLine {
  return {
    name: identity.handle && identity.handleVerified ? `@${identity.handle}` : identity.did,
    did: identity.did,
    forum: identity.forum,
    ...(identity.forum && identity.forumName ? { forumName: identity.forumName } : {}),
    checked: !identity.unavailable,
  };
}

export interface SourceTrackerOptions {
  lookup: (did: string) => Promise<SourceIdentity>;
  update: (state: SourceState) => void;
}

/**
 * The page's one active source. A new DID replaces the current one and an
 * answer for a replaced DID is dropped; naming the current DID again does
 * nothing, so a chatty panel costs one lookup.
 */
export function createSourceTracker({ lookup, update }: SourceTrackerOptions) {
  let current: string | null = null;
  let closed = false;

  return {
    set(did: string) {
      if (closed || did === current) return;
      current = did;
      update({ status: 'checking', did });
      lookup(did)
        .catch(() => unresolvedSource(did))
        .then((identity) => {
          if (!closed && current === did) update({ status: 'checked', identity });
        });
    },
    close() {
      closed = true;
    },
  };
}
