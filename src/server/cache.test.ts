import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "./cache";

describe("TtlCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("serves an entry inside its TTL as fresh", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("k", "value");

    const hit = cache.getFresh("k");
    expect(hit?.value).toBe("value");
    expect(hit?.stale).toBe(false);
  });

  it("reports a miss for an unknown key", () => {
    expect(new TtlCache<string>(1000).getFresh("nope")).toBeNull();
  });

  it("stops treating an entry as fresh once the TTL passes", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("k", "value");

    vi.advanceTimersByTime(1001);
    expect(cache.getFresh("k")).toBeNull();
  });

  it("still offers an expired entry as a stale fallback", () => {
    // This is what keeps the map populated when IMO is unreachable.
    const cache = new TtlCache<string>(1000, 60_000);
    cache.set("k", "value");

    vi.advanceTimersByTime(5000);
    const usable = cache.getUsable("k");
    expect(usable?.value).toBe("value");
    expect(usable?.stale).toBe(true);
  });

  it("marks a fallback that is still within its TTL as not stale", () => {
    const cache = new TtlCache<string>(1000, 60_000);
    cache.set("k", "value");

    expect(cache.getUsable("k")?.stale).toBe(false);
  });

  it("drops an entry once it is too old to serve at all", () => {
    // Past this point we would rather show an error than data from hours ago.
    const cache = new TtlCache<string>(1000, 10_000);
    cache.set("k", "value");

    vi.advanceTimersByTime(10_001);
    expect(cache.getUsable("k")).toBeNull();
  });

  it("replaces a value and resets its age", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("k", "first");
    vi.advanceTimersByTime(900);
    cache.set("k", "second");
    vi.advanceTimersByTime(900);

    expect(cache.getFresh("k")?.value).toBe("second");
  });

  it("keeps keys independent", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("a", "A");
    vi.advanceTimersByTime(600);
    cache.set("b", "B");
    vi.advanceTimersByTime(600);

    expect(cache.getFresh("a")).toBeNull();
    expect(cache.getFresh("b")?.value).toBe("B");
  });

  it("evicts the oldest entry once it is full", () => {
    // Detail is keyed by event id, which is unbounded; without this the cache
    // would grow with every distinct event anyone ever opens.
    const cache = new TtlCache<string>(60_000, 60_000, 3);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    cache.set("d", "D");

    expect(cache.size).toBe(3);
    expect(cache.getUsable("a")).toBeNull();
    expect(cache.getUsable("d")?.value).toBe("D");
  });

  it("treats a refreshed entry as recently used, not as the next to evict", () => {
    const cache = new TtlCache<string>(60_000, 60_000, 3);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    cache.set("a", "A2");   // refresh the oldest
    cache.set("d", "D");    // should evict "b", not "a"

    expect(cache.getUsable("a")?.value).toBe("A2");
    expect(cache.getUsable("b")).toBeNull();
  });

  it("is unbounded by default", () => {
    const cache = new TtlCache<string>(60_000);
    for (let i = 0; i < 50; i += 1) cache.set(`k${i}`, `v${i}`);
    expect(cache.size).toBe(50);
  });

  it("clears everything", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("k", "value");
    cache.clear();
    expect(cache.getUsable("k")).toBeNull();
  });
});
