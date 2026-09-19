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

  it("clears everything", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("k", "value");
    cache.clear();
    expect(cache.getUsable("k")).toBeNull();
  });
});
