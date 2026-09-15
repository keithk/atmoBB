import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The name lookups' cache, concurrency, and rate limit. What they answer is
// covered through the endpoint in routes/x/[install]/names.

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { NAMES_CACHE_MAX, NAME_LOOKUPS_PER_CLIENT_PER_MINUTE, NAME_LOOKUP_CONCURRENCY, lookupNames, namesCacheSizesForTests, resetNamesForTests, takeNameLookup } from './names';
import { resetSourceForTests, setSourceDepsForTests } from './source';

const DID = 'did:plc:5qartdsce62n2wfyvtocmoob';
const INSTALL = 'AAAAAAAAAAAAAAAAAAAAAA';

/** Every account claims `<id>.example.com`, verified over DNS; `verified` false makes DNS name another DID. */
function deps({ fail = false, verified = true } = {}) {
  return {
    resolveDidDocument: vi.fn(async (did: string) => {
      if (fail) throw new Error('offline');
      return { id: did, alsoKnownAs: [`at://${did.slice('did:plc:'.length)}.example.com`], service: [] };
    }),
    resolveTxt: vi.fn(async (hostname: string) => [[`did=${verified ? `did:plc:${hostname.slice('_atproto.'.length, -'.example.com'.length)}` : 'did:plc:someoneelse'}`]]),
    fetch: vi.fn(),
  };
}

beforeEach(() => {
  resetSourceForTests();
  resetNamesForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetSourceForTests();
  resetNamesForTests();
});

describe('lookupNames', () => {
  it('shares one lookup between concurrent requests for a DID, and caches a verified name for five minutes', async () => {
    const network = deps();
    setSourceDepsForTests(network as never);
    const [first, second] = await Promise.all([lookupNames([DID], []), lookupNames([DID], [])]);
    expect(first).toEqual({ names: { [DID]: { handle: '5qartdsce62n2wfyvtocmoob.example.com' } }, dids: {} });
    expect(second).toEqual(first);
    expect(network.resolveDidDocument).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(4 * 60_000);
    await lookupNames([DID], []);
    expect(network.resolveDidDocument).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    await lookupNames([DID], []);
    expect(network.resolveDidDocument).toHaveBeenCalledTimes(2);
  });

  it('retries an unresolved or unverified name after thirty seconds', async () => {
    for (const network of [deps({ fail: true }), deps({ verified: false })]) {
      resetNamesForTests();
      setSourceDepsForTests(network as never);
      expect((await lookupNames([DID], [])).names[DID]).toBeNull();
      vi.advanceTimersByTime(29_000);
      await lookupNames([DID], []);
      expect(network.resolveDidDocument).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1_000);
      await lookupNames([DID], []);
      expect(network.resolveDidDocument).toHaveBeenCalledTimes(2);
    }
  });

  it(`runs at most ${NAME_LOOKUP_CONCURRENCY} lookups at once`, async () => {
    let running = 0;
    let most = 0;
    const network = deps();
    network.resolveDidDocument.mockImplementation(async (did: string) => {
      most = Math.max(most, ++running);
      await Promise.resolve();
      running--;
      return { id: did, alsoKnownAs: [], service: [] };
    });
    setSourceDepsForTests(network as never);
    await lookupNames(Array.from({ length: 40 }, (_, i) => `did:plc:account${i}`), []);
    expect(network.resolveDidDocument).toHaveBeenCalledTimes(40);
    expect(most).toBe(NAME_LOOKUP_CONCURRENCY);
  });

  it('keeps the cache bounded', async () => {
    setSourceDepsForTests(deps() as never);
    for (let batch = 0; batch * 100 < NAMES_CACHE_MAX + 100; batch++) {
      await lookupNames(Array.from({ length: 100 }, (_, i) => `did:plc:account${batch}x${i}`), []);
    }
    expect(namesCacheSizesForTests().names).toBe(NAMES_CACHE_MAX);
  });
});

describe('takeNameLookup', () => {
  it('allows a client its lookups per minute on each install, then refuses until the window moves on', () => {
    for (let i = 0; i < NAME_LOOKUPS_PER_CLIENT_PER_MINUTE; i++) expect(takeNameLookup(INSTALL, '203.0.113.9')).toBe(true);
    expect(takeNameLookup(INSTALL, '203.0.113.9')).toBe(false);
    expect(takeNameLookup(INSTALL, '198.51.100.4')).toBe(true);
    expect(takeNameLookup('BBBBBBBBBBBBBBBBBBBBBB', '203.0.113.9')).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(takeNameLookup(INSTALL, '203.0.113.9')).toBe(true);
  });
});
