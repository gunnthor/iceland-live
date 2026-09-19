/**
 * A small in-process cache that keeps serving after upstream failures.
 *
 * Two layers protect the IMO API and our users:
 *
 *  1. `fetch(..., { next: { revalidate } })` inside the IMO client uses the
 *     Next.js data cache, which is shared across server instances on Vercel.
 *     That is what limits how often we actually call IMO.
 *  2. This module caches the *parsed and normalized* result, so we do not
 *     re-parse ~450 KB of CSV on every request, and so we retain a last-known-
 *     good snapshot to serve if IMO becomes unreachable.
 *
 * The second layer is what makes the "stale" state possible: rather than
 * showing an empty map during an upstream outage, we show the last real data we
 * hold and label it clearly. We never substitute invented data.
 */

export type CacheEntry<T> = {
  value: T;
  storedAt: number;
};

export type CacheLookup<T> = {
  value: T;
  storedAt: number;
  /** True when the entry is past its TTL but still usable as a fallback. */
  stale: boolean;
};

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    /** How long an expired entry may still be served if upstream fails. */
    private readonly maxStaleMs: number = 6 * 60 * 60 * 1000,
  ) {}

  /** Returns a fresh entry, or `null` when there is none. */
  getFresh(key: string): CacheLookup<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.storedAt;
    if (age > this.ttlMs) return null;
    return { value: entry.value, storedAt: entry.storedAt, stale: false };
  }

  /** Returns any entry still inside the stale window, fresh or not. */
  getUsable(key: string): CacheLookup<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.storedAt;
    if (age > this.maxStaleMs) {
      this.entries.delete(key);
      return null;
    }
    return { value: entry.value, storedAt: entry.storedAt, stale: age > this.ttlMs };
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, storedAt: Date.now() });
  }

  clear(): void {
    this.entries.clear();
  }
}
