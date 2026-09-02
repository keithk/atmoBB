import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ONLINE_MS = 5 * 60 * 1000;
const IDLE_MS = 15 * 60 * 1000;
const HIGH_WATER_PATH = 'data/presence-high-water.json';

const members = new Map<string, number>(); // did → lastSeen (ms)
const guests = new Map<string, number>(); // anonymized key → lastSeen (ms)

let high = { count: 0, at: '' };
try {
  high = JSON.parse(readFileSync(HIGH_WATER_PATH, 'utf8'));
} catch {
  // first run, or the file was cleaned up — the record starts over
}

function prune(map: Map<string, number>, now: number) {
  for (const [k, at] of map) if (now - at > IDLE_MS) map.delete(k);
}

function onlineCount(now: number): number {
  let n = 0;
  for (const at of members.values()) if (now - at <= ONLINE_MS) n++;
  for (const at of guests.values()) if (now - at <= ONLINE_MS) n++;
  return n;
}

function noteHighWater() {
  const now = Date.now();
  prune(members, now);
  prune(guests, now);
  const count = onlineCount(now);
  if (count > high.count) {
    high = { count, at: new Date(now).toISOString() };
    try {
      mkdirSync('data', { recursive: true });
      writeFileSync(HIGH_WATER_PATH, JSON.stringify(high));
    } catch {
      // losing the high-water mark is survivable
    }
  }
}

export function touchMember(did: string) {
  members.set(did, Date.now());
  noteHighWater();
}

export function touchGuest(ip: string, userAgent: string) {
  // Guests are counted, never identified: hash and forget
  const key = createHash('sha256').update(`${ip}\n${userAgent}`).digest('hex').slice(0, 16);
  guests.set(key, Date.now());
  noteHighWater();
}

export interface PresenceSnapshot {
  members: { did: string; presence: 'online' | 'idle' }[];
  guests: number;
  high: { count: number; at: string };
}

export function presenceSnapshot(): PresenceSnapshot {
  const now = Date.now();
  prune(members, now);
  prune(guests, now);
  const list = [...members.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([did, at]) => ({
      did,
      presence: now - at <= ONLINE_MS ? ('online' as const) : ('idle' as const),
    }));
  let g = 0;
  for (const at of guests.values()) if (now - at <= ONLINE_MS) g++;
  return { members: list, guests: g, high };
}
