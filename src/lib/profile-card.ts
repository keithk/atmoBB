import type { TrayEntry } from './server/appview';
import type { Handles } from './stamps';

export interface ProfileCard {
  did: string;
  handle: string;
  displayName: string;
  profile: Record<string, unknown> | null;
  presence: 'online' | 'idle' | 'offline';
  /** ISO date the member's atmosphere profile was created ("here since"), or null if unknown. */
  joined: string | null;
  bsky: { handle: string } | null;
  isYou: boolean;
  /** The stamps the member wears on this forum, in their order; the arrival stamp carries how they came in. */
  stamps: TrayEntry[];
  /** DID to handle for any sponsor an arrival stamp names. */
  handles: Handles;
}

/** "Jul 2026" for the member's profile creation date, or null when there isn't one. */
export function hereSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
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
