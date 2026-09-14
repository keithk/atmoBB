// Sliding windows of event times, one per key, in memory. A restart forgets
// them. At most `maxKeys` keys are tracked: past that, the key that least
// recently took a slot is dropped and starts over with a fresh window. A key
// whose window has emptied is dropped when it's next looked at, since an empty
// window and no window count the same.

export class RateWindows {
  private readonly windows = new Map<string, number[]>();

  constructor(readonly maxKeys: number) {}

  /** The times in `key`'s window from the last `spanMs`, dropping the key when there are none. */
  private recent(key: string, spanMs: number, now: number): number[] {
    const recent = (this.windows.get(key) ?? []).filter((at) => now - at < spanMs);
    if (!recent.length) this.windows.delete(key);
    return recent;
  }

  /** Take a slot in `key`'s window, or return false when `limit` slots in the last `spanMs` are taken. */
  take(key: string, limit: number, spanMs: number, now = Date.now()): boolean {
    const recent = this.recent(key, spanMs, now);
    if (recent.length >= limit) {
      if (recent.length) this.windows.set(key, recent);
      return false;
    }
    recent.push(now);
    this.windows.delete(key);
    this.windows.set(key, recent);
    while (this.windows.size > this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
    return true;
  }

  /** How many of `limit` slots in `key`'s last `spanMs` are free. */
  left(key: string, limit: number, spanMs: number, now = Date.now()): number {
    return limit - this.recent(key, spanMs, now).length;
  }

  /** How many keys have a window. */
  get size(): number {
    return this.windows.size;
  }

  clear() {
    this.windows.clear();
  }
}
