import { describe, expect, it } from "vitest";
import type { Earthquake } from "@/domain/earthquake";
import { computeStats, filterByRange, median, tallyByRegion } from "./stats";

function quake(overrides: Partial<Earthquake> = {}): Earthquake {
  return {
    id: "IMO-1",
    occurredAt: "2026-09-19T12:00:00.000Z",
    updatedAt: null,
    latitude: 63.9,
    longitude: -22.1,
    depthKm: 5,
    magnitude: 1,
    magnitudeType: "ML_SIL",
    region: "Reykjanes",
    eventType: "earthquake",
    reviewStatus: "reviewed",
    evaluationMode: "manual",
    source: "IMO",
    ...overrides,
  };
}

describe("median", () => {
  it("returns the middle value for an odd count", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for an empty set", () => {
    expect(median([])).toBeNull();
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("filterByRange", () => {
  const quakes = [
    quake({ id: "a", occurredAt: "2026-09-19T10:00:00.000Z" }),
    quake({ id: "b", occurredAt: "2026-09-19T12:00:00.000Z" }),
    quake({ id: "c", occurredAt: "2026-09-19T14:00:00.000Z" }),
  ];

  it("includes the lower bound and excludes the upper bound", () => {
    const result = filterByRange(
      quakes,
      new Date("2026-09-19T10:00:00.000Z"),
      new Date("2026-09-19T14:00:00.000Z"),
    );
    expect(result.map((q) => q.id)).toEqual(["a", "b"]);
  });

  it("returns nothing when the window is empty", () => {
    const result = filterByRange(
      quakes,
      new Date("2026-09-19T20:00:00.000Z"),
      new Date("2026-09-19T21:00:00.000Z"),
    );
    expect(result).toEqual([]);
  });

  it("compares instants rather than strings, so offsets are handled", () => {
    // 12:00Z expressed as 14:00+02:00 must still fall inside an 11:00Z-13:00Z window.
    const offset = [quake({ id: "offset", occurredAt: "2026-09-19T12:00:00.000Z" })];
    const result = filterByRange(
      offset,
      new Date("2026-09-19T14:00:00+02:00"),
      new Date("2026-09-19T15:00:00+02:00"),
    );
    expect(result.map((q) => q.id)).toEqual(["offset"]);
  });

  it("drops events with an unparseable timestamp", () => {
    const result = filterByRange(
      [quake({ id: "bad", occurredAt: "nonsense" })],
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2030-01-01T00:00:00.000Z"),
    );
    expect(result).toEqual([]);
  });
});

describe("computeStats", () => {
  const window = {
    from: new Date("2026-09-19T00:00:00.000Z"),
    to: new Date("2026-09-19T12:00:00.000Z"),
  };

  it("summarises an empty set without inventing values", () => {
    const stats = computeStats([], window);
    expect(stats).toMatchObject({
      count: 0,
      largest: null,
      deepest: null,
      latest: null,
      medianDepthKm: null,
      countM2Plus: 0,
      countM3Plus: 0,
      reviewedCount: 0,
      ratePerHour: 0,
    });
  });

  it("finds the largest, deepest and latest events", () => {
    const stats = computeStats(
      [
        quake({ id: "big", magnitude: 3.1, depthKm: 2, occurredAt: "2026-09-19T01:00:00.000Z" }),
        quake({ id: "deep", magnitude: 1.2, depthKm: 12.7, occurredAt: "2026-09-19T02:00:00.000Z" }),
        quake({ id: "recent", magnitude: 0.4, depthKm: 5, occurredAt: "2026-09-19T11:00:00.000Z" }),
      ],
      window,
    );

    expect(stats.largest?.id).toBe("big");
    expect(stats.deepest?.id).toBe("deep");
    expect(stats.latest?.id).toBe("recent");
  });

  it("ignores null magnitudes when picking the largest", () => {
    const stats = computeStats(
      [quake({ id: "unknown", magnitude: null }), quake({ id: "known", magnitude: 0.2 })],
      window,
    );
    expect(stats.largest?.id).toBe("known");
  });

  it("returns a null largest when no event has a magnitude", () => {
    const stats = computeStats([quake({ magnitude: null })], window);
    expect(stats.largest).toBeNull();
  });

  it("breaks magnitude ties toward the more recent event", () => {
    const stats = computeStats(
      [
        quake({ id: "earlier", magnitude: 2.5, occurredAt: "2026-09-19T01:00:00.000Z" }),
        quake({ id: "later", magnitude: 2.5, occurredAt: "2026-09-19T05:00:00.000Z" }),
      ],
      window,
    );
    expect(stats.largest?.id).toBe("later");
  });

  it("treats a zero depth as a real measurement", () => {
    const stats = computeStats([quake({ id: "surface", depthKm: 0 })], window);
    expect(stats.deepest?.id).toBe("surface");
    expect(stats.medianDepthKm).toBe(0);
  });

  it("counts magnitude thresholds inclusively", () => {
    const stats = computeStats(
      [quake({ magnitude: 2 }), quake({ magnitude: 3 }), quake({ magnitude: 1.99 })],
      window,
    );
    expect(stats.countM2Plus).toBe(2);
    expect(stats.countM3Plus).toBe(1);
  });

  it("counts only reviewed solutions as reviewed", () => {
    const stats = computeStats(
      [
        quake({ reviewStatus: "reviewed" }),
        quake({ reviewStatus: "automatic" }),
        quake({ reviewStatus: "unknown" }),
      ],
      window,
    );
    expect(stats.reviewedCount).toBe(1);
  });

  it("computes the rate per hour from the window length", () => {
    const stats = computeStats([quake(), quake(), quake(), quake(), quake(), quake()], window);
    expect(stats.ratePerHour).toBeCloseTo(0.5); // 6 events over 12 hours
  });

  it("reports a null rate when no window is supplied", () => {
    expect(computeStats([quake()]).ratePerHour).toBeNull();
  });
});

describe("tallyByRegion", () => {
  it("counts per region, busiest first", () => {
    const result = tallyByRegion([
      quake({ region: "Reykjanes", magnitude: 1 }),
      quake({ region: "Reykjanes", magnitude: 2.4 }),
      quake({ region: "Katla", magnitude: 0.5 }),
    ]);

    expect(result.map((r) => ({ ...r, centre: null, latestAt: null }))).toEqual([
      { region: "Reykjanes", count: 2, largestMagnitude: 2.4, centre: null, latestAt: null },
      { region: "Katla", count: 1, largestMagnitude: 0.5, centre: null, latestAt: null },
    ]);
  });

  it("averages member positions so the list can frame a region on the map", () => {
    const result = tallyByRegion([
      quake({ region: "Reykjanes", latitude: 63.8, longitude: -22.0 }),
      quake({ region: "Reykjanes", latitude: 64.0, longitude: -22.4 }),
    ]);
    expect(result[0]?.centre?.latitude).toBeCloseTo(63.9, 5);
    expect(result[0]?.centre?.longitude).toBeCloseTo(-22.2, 5);
  });

  it("records the most recent event per region", () => {
    const result = tallyByRegion([
      quake({ region: "Katla", occurredAt: "2026-09-19T01:00:00.000Z" }),
      quake({ region: "Katla", occurredAt: "2026-09-19T09:00:00.000Z" }),
    ]);
    expect(result[0]?.latestAt).toBe("2026-09-19T09:00:00.000Z");
  });

  it("skips events with no region rather than inventing one", () => {
    expect(tallyByRegion([quake({ region: null })])).toEqual([]);
  });

  it("reports a null largest magnitude when a region has no measured magnitudes", () => {
    const result = tallyByRegion([quake({ region: "Hekla", magnitude: null })]);
    expect(result[0]).toMatchObject({ region: "Hekla", count: 1, largestMagnitude: null });
  });
});
