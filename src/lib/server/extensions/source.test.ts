import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The source resolver's cache and rate limit. What it answers for a DID is
// covered through the endpoint in routes/x/[install]/source.

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
  SOURCE_CACHE_MAX,
  SOURCE_LOOKUPS_PER_CLIENT_PER_MINUTE,
  resetSourceForTests,
  setSourceDepsForTests,
  sourceCacheSizeForTests,
  sourceIdentity,
  takeSourceLookup,
} from './source';

const DID = 'did:plc:dvh42fok55dox6pzlyevelz6';

function deps(fail = false) {
  return {
    resolveDidDocument: vi.fn(async (did: string) => {
      if (fail) throw new Error('offline');
      return { id: did, alsoKnownAs: [], service: [] };
    }),
    resolveTxt: vi.fn(async () => []),
    fetch: vi.fn(),
  };
}

beforeEach(() => {
  resetSourceForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetSourceForTests();
});

describe('sourceIdentity', () => {
  it('shares one lookup between concurrent requests for a DID, and caches the answer for five minutes', async () => {
    const network = deps();
    setSourceDepsForTests(network as never);
    const [first, second] = await Promise.all([sourceIdentity(DID), sourceIdentity(DID)]);
    expect(first).toEqual(second);
    expect(network.resolveDidDocument).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(4 * 60_000);
    await sourceIdentity(DID);
    expect(network.resolveDidDocument).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    await sourceIdentity(DID);
    expect(network.resolveDidDocument).toHaveBeenCalledTimes(2);
  });

  it('retries an unavailable answer after thirty seconds', async () => {
    const network = deps(true);
    setSourceDepsForTests(network as never);
    expect(await sourceIdentity(DID)).toMatchObject({ unavailable: true });
    vi.advanceTimersByTime(29_000);
    await sourceIdentity(DID);
    expect(network.resolveDidDocument).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    await sourceIdentity(DID);
    expect(network.resolveDidDocument).toHaveBeenCalledTimes(2);
  });

  it('keeps the cache bounded', async () => {
    setSourceDepsForTests(deps() as never);
    for (let i = 0; i < SOURCE_CACHE_MAX + 20; i++) await sourceIdentity(`did:plc:account${i}`);
    expect(sourceCacheSizeForTests()).toBe(SOURCE_CACHE_MAX);
  });
});

describe('takeSourceLookup', () => {
  it('allows a client its lookups per minute, then refuses until the window moves on', () => {
    for (let i = 0; i < SOURCE_LOOKUPS_PER_CLIENT_PER_MINUTE; i++) expect(takeSourceLookup('203.0.113.9')).toBe(true);
    expect(takeSourceLookup('203.0.113.9')).toBe(false);
    expect(takeSourceLookup('198.51.100.4')).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(takeSourceLookup('203.0.113.9')).toBe(true);
  });
});
