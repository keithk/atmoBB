import { getDirectory, FORUM_DID, resolveHandle } from './appview';

interface RingForum {
  did: string;
  name: string;
}

let cache: { forums: RingForum[]; at: number } | null = null;

export async function ringForums(): Promise<RingForum[]> {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.forums;
  try {
    const dir = await getDirectory();
    cache = { forums: dir.forums.map((f) => ({ did: f.did, name: f.name })), at: Date.now() };
  } catch {
    // keep serving a stale ring over no ring
    if (!cache) return [];
  }
  return cache.forums;
}

/** The neighbor to visit, or null when the ring is too small to spin. */
export async function ringNeighbor(dir: 'next' | 'prev' | 'random'): Promise<string | null> {
  const forums = await ringForums();
  const ring = forums.map((f) => f.did);
  if (ring.length < 2) return null;
  const self = Math.max(0, ring.indexOf(FORUM_DID()));
  let target: string;
  if (dir === 'random') {
    const others = ring.filter((d) => d !== FORUM_DID());
    target = others[Math.floor(Math.random() * others.length)];
  } else {
    const step = dir === 'next' ? 1 : -1;
    target = ring[(self + step + ring.length) % ring.length];
  }
  const handle = await resolveHandle(target);
  // A handle that didn't resolve is a ring stop with no door; skip out
  return handle === target ? null : `https://${handle}`;
}
