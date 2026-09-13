export interface ProfileCard {
  did: string;
  handle: string;
  displayName: string;
  profile: Record<string, unknown> | null;
  presence: 'online' | 'idle' | 'offline';
  /** Postcount on this forum, or null when they aren't a member here. */
  posts: number | null;
  /** Public postcount across every indexed atmobb forum. */
  globalPosts: number | null;
  rankTitle: string;
  /** ISO date we treat as "member since", or null if unknown. */
  joined: string | null;
  bsky: { handle: string } | null;
  isYou: boolean;
  /** On a gated forum, how this member came in (see sponsorLine); null elsewhere.
   *  `handle` is the sponsor's resolved handle for the link, or null. */
  sponsor: { text: string; handle: string | null } | null;
}

const cardCache = new Map<string, Promise<ProfileCard | null>>();

/** Load a profile card once per actor, shared by mentions and hover cards. */
export function loadProfileCard(actor: string): Promise<ProfileCard | null> {
  const key = actor.toLowerCase();
  let hit = cardCache.get(key);
  if (!hit) {
    hit = fetch(`/members/${encodeURIComponent(actor)}/card.json`)
      .then((response) => (response.ok ? (response.json() as Promise<ProfileCard>) : null))
      .catch(() => null);
    cardCache.set(key, hit);
  }
  return hit;
}

/** Canonical profile URL for a member. DIDs always resolve; handles may not. */
export function profileHref(didOrActor: string): string {
  return `/members/${encodeURIComponent(didOrActor)}`;
}
